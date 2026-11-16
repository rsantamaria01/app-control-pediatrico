import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { eq, sql } from 'drizzle-orm'
import { Pool } from 'pg'
import { bookingRequest, emailHealth, notificationAttempt, notificationOutbox } from '../../server/db/schema'
import { deliver, processNotificationOutbox, providerStatus, queueNotification } from '../../server/services/outbox'
import { emailProviderHealth, markEmailFailure, sendBookingCode } from '../../server/services/email'
import { saveSmtpSettings } from '../../server/services/smtp-settings'

const source = process.env.DATABASE_URL
if (!source || !new URL(source).pathname.includes('pediatrico')) throw new Error('Dedicated pediatric test server required')
const name = `pediatrico_smtp_outbox_${randomUUID().replaceAll('-', '')}`
const adminUrl = new URL(source)
adminUrl.pathname = '/postgres'
const target = new URL(source)
target.pathname = `/${name}`
const adminPool = new Pool({ connectionString: adminUrl.href })
const pool = new Pool({ connectionString: target.href })
const db = drizzle(pool)
const previousUrl = process.env.DATABASE_URL
const previousKey = process.env.SMTP_CONFIG_KEY
const envNames = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'] as const
const previousEnv = Object.fromEntries(envNames.map(key => [key, process.env[key]]))
const now = new Date('2027-03-01T15:00:00Z')
let created = false

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${name}"`)
  created = true
  process.env.DATABASE_URL = target.href
  await migrate(db, { migrationsFolder: './server/db/migrations' })
}, 120000)

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE notification_attempt, notification_outbox, booking_request, smtp_settings, email_health RESTART IDENTITY CASCADE`)
  process.env.SMTP_CONFIG_KEY = 'a1'.repeat(32)
  for (const key of envNames) Reflect.deleteProperty(process.env, key)
})

afterAll(async () => {
  process.env.DATABASE_URL = previousUrl
  if (previousKey === undefined) delete process.env.SMTP_CONFIG_KEY
  else process.env.SMTP_CONFIG_KEY = previousKey
  for (const key of envNames) {
    const value = previousEnv[key]
    if (value === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = value
  }
  await pool.end()
  const { useDb } = await import('../../server/utils/db')
  await useDb().$client.end()
  try {
    if (created) await adminPool.query(`DROP DATABASE "${name}"`)
  } finally {
    await adminPool.end()
  }
})

async function queued(channel: 'EMAIL' | 'WHATSAPP' = 'EMAIL') {
  const subjectId = randomUUID()
  await db.insert(bookingRequest).values({ id: subjectId, source: 'PUBLIC', childName: 'Paciente', guardianName: 'Familia', email: 'family@example.test', startsAt: new Date('2027-03-02T14:00:00Z'), consentVersion: 'DRAFT-2026-11' })
  if (channel === 'WHATSAPP') {
    return db.insert(notificationOutbox).values({ id: randomUUID(), eventKind: 'BOOKING_PENDING', subjectId, channel, recipientKey: randomUUID() }).returning({ id: notificationOutbox.id }).then(rows => rows[0]!.id)
  }
  return db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId }, { channel: 'EMAIL', address: 'family@example.test' }))
}

async function smtpServer(reply: string) {
  const messages: string[] = []
  const server = createServer((socket) => {
    socket.write('220 local smtp\r\n')
    let buffer = ''
    let data = false
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      let end = buffer.indexOf('\r\n')
      while (end >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        if (data) {
          if (line === '.') {
            data = false
            messages.push('accepted')
            socket.write('250 queued\r\n')
          }
        } else if (/^EHLO|^HELO/i.test(line)) socket.write('250-local\r\n250 OK\r\n')
        else if (/^MAIL FROM:/i.test(line)) socket.write('250 OK\r\n')
        else if (/^RCPT TO:/i.test(line)) socket.write(`${reply}\r\n`)
        else if (/^DATA/i.test(line)) {
          data = true
          socket.write('354 go\r\n')
        } else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n')
        end = buffer.indexOf('\r\n')
      }
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('SMTP listener unavailable')
  return { port: address.port, messages, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
}

function env(port: number) {
  Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_SECURE: 'false', SMTP_FROM: 'Clínica <clinic@example.test>' })
}

it('delivers a queued email via environment SMTP without an explicit adapter', async () => {
  const server = await smtpServer('250 OK')
  try {
    env(server.port)
    const id = await queued()
    expect(await providerStatus('EMAIL')).toBe('READY')
    expect(await deliver(id, now)).toEqual({ id, status: 'SENT' })
    expect(server.messages).toHaveLength(1)
    expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]).toMatchObject({ state: 'SENT', deliveredAt: now })
    expect(await emailProviderHealth()).toBe('CONFIGURED')
  } finally { await server.close() }
})

it('does not mark recipient rejection as sent or retry it', async () => {
  const server = await smtpServer('550 rejected')
  try {
    env(server.port)
    const id = await queued()
    expect(await deliver(id, now)).toEqual({ id, status: 'FAILED' })
    expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]).toMatchObject({ state: 'FAILED', deliveredAt: null })
    expect(server.messages).toHaveLength(0)
    expect(await emailProviderHealth()).toBe('FAILING')
    expect((await db.select().from(emailHealth))[0]).toMatchObject({ state: 'FAILING' })
  } finally { await server.close() }
})

it('recovers persisted provider health after a later successful SMTP send', async () => {
  const rejected = await smtpServer('550 rejected')
  try {
    env(rejected.port)
    const id = await queued()
    expect(await deliver(id, now)).toEqual({ id, status: 'FAILED' })
    expect(await providerStatus('EMAIL')).toBe('FAILED')
    expect((await db.select().from(emailHealth))[0]).toMatchObject({ state: 'FAILING' })
  } finally { await rejected.close() }
  const recovered = await smtpServer('250 OK')
  try {
    env(recovered.port)
    const { sendBookingCode } = await import('../../server/services/email')
    await sendBookingCode('family@example.test', '654321')
    expect(recovered.messages).toHaveLength(1)
    expect(await providerStatus('EMAIL')).toBe('READY')
  } finally { await recovered.close() }
})

it('allows a new notice to recover after an earlier provider failure', async () => {
  const rejected = await smtpServer('550 rejected')
  try {
    env(rejected.port)
    expect(await deliver(await queued(), now)).toMatchObject({ status: 'FAILED' })
    expect(await providerStatus('EMAIL')).toBe('FAILED')
  } finally { await rejected.close() }
  const recovered = await smtpServer('250 OK')
  try {
    env(recovered.port)
    const id = await queued()
    expect(await deliver(id, now)).toEqual({ id, status: 'SENT' })
    expect(await providerStatus('EMAIL')).toBe('READY')
  } finally { await recovered.close() }
})

it('fails closed on missing admin encryption key rather than using environment SMTP', async () => {
  const server = await smtpServer('250 OK')
  try {
    env(server.port)
    await saveSmtpSettings({ id: randomUUID(), roles: ['ADMIN'] }, { host: '127.0.0.1', port: server.port, security: 'NONE', username: '', password: '', fromName: 'Clínica', fromAddress: 'clinic@example.test' })
    delete process.env.SMTP_CONFIG_KEY
    const id = await queued()
    expect(await providerStatus('EMAIL')).toBe('NOT_CONFIGURED')
    expect(await deliver(id, now)).toEqual({ id, status: 'NOT_CONFIGURED' })
    expect(server.messages).toHaveLength(0)
    expect(JSON.stringify(await db.select().from(notificationAttempt))).not.toContain('private-password')
  } finally { await server.close() }
})

it('requeues only unsent unconfigured email on the first healthy poll after admin saves SMTP', async () => {
  const server = await smtpServer('250 OK')
  try {
    const id = await queued()
    expect(await deliver(id, now)).toMatchObject({ status: 'NOT_CONFIGURED' })
    const [before] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id))
    expect(before).toMatchObject({ state: 'NOT_CONFIGURED', attempts: 1, deliveredAt: null })
    const whatsapp = await queued('WHATSAPP')
    await db.update(notificationOutbox).set({ state: 'NOT_CONFIGURED', errorClass: 'ProviderNotConfigured' }).where(eq(notificationOutbox.id, whatsapp))
    const uncertain = await queued()
    await db.update(notificationOutbox).set({ state: 'FAILED', errorClass: 'DeliveryUncertain' }).where(eq(notificationOutbox.id, uncertain))
    await saveSmtpSettings({ id: randomUUID(), roles: ['ADMIN'] }, { host: '127.0.0.1', port: server.port, security: 'NONE', username: '', password: '', fromName: 'Clínica', fromAddress: 'clinic@example.test' })
    expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]).toMatchObject({ state: 'NOT_CONFIGURED', attempts: 1, deliveredAt: null })
    expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, whatsapp)))[0]).toMatchObject({ state: 'NOT_CONFIGURED' })
    expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, uncertain)))[0]).toMatchObject({ state: 'FAILED', errorClass: 'DeliveryUncertain' })
    expect(await processNotificationOutbox(now)).toBe(1)
    expect(server.messages).toHaveLength(1)
    expect(await processNotificationOutbox(now)).toBe(0)
    expect(await db.select().from(notificationAttempt).where(eq(notificationAttempt.outboxId, id))).toMatchObject([{ outcome: 'NOT_CONFIGURED' }, { outcome: 'SENT' }])
  } finally { await server.close() }
})

it('requeues unconfigured email when SMTP is supplied by environment at worker startup, never uncertain email', async () => {
  const server = await smtpServer('250 OK')
  try {
    const id = await queued()
    expect(await deliver(id, now)).toMatchObject({ status: 'NOT_CONFIGURED' })
    const uncertain = await queued()
    await db.update(notificationOutbox).set({ state: 'FAILED', errorClass: 'InterruptedDelivery' }).where(eq(notificationOutbox.id, uncertain))
    env(server.port)
    expect(await processNotificationOutbox(now)).toBe(1)
    expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]).toMatchObject({ state: 'SENT' })
    expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, uncertain)))[0]).toMatchObject({ state: 'FAILED', errorClass: 'InterruptedDelivery' })
    expect(server.messages).toHaveLength(1)
  } finally { await server.close() }
})

it('keeps parked email parked while effective SMTP health is failing and requeues only after READY', async () => {
  const server = await smtpServer('250 OK')
  try {
    const id = await queued()
    expect(await deliver(id, now)).toMatchObject({ status: 'NOT_CONFIGURED' })
    env(server.port)
    await markEmailFailure()
    expect(await providerStatus('EMAIL')).toBe('FAILED')
    expect(await processNotificationOutbox(now)).toBe(0)
    expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]).toMatchObject({ state: 'NOT_CONFIGURED', errorClass: 'ProviderNotConfigured' })
    await sendBookingCode('family@example.test', '654321')
    expect(await providerStatus('EMAIL')).toBe('READY')
    expect(await processNotificationOutbox(now)).toBe(1)
    expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]).toMatchObject({ state: 'SENT' })
    expect(server.messages).toHaveLength(2)
  } finally { await server.close() }
})

it('admin SMTP save leaves parked email for the next healthy worker poll', async () => {
  const server = await smtpServer('250 OK')
  try {
    const id = await queued()
    expect(await deliver(id, now)).toMatchObject({ status: 'NOT_CONFIGURED' })
    await saveSmtpSettings({ id: randomUUID(), roles: ['ADMIN'] }, { host: '127.0.0.1', port: server.port, security: 'NONE', username: '', password: '', fromName: 'Clínica', fromAddress: 'clinic@example.test' })
    expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]).toMatchObject({ state: 'NOT_CONFIGURED' })
    await markEmailFailure()
    expect(await processNotificationOutbox(now)).toBe(0)
    expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]).toMatchObject({ state: 'NOT_CONFIGURED' })
    await sendBookingCode('family@example.test', '654321')
    expect(await processNotificationOutbox(now)).toBe(1)
    expect(server.messages).toHaveLength(2)
  } finally { await server.close() }
})

it('does not let an unconfigured WhatsApp backlog consume the email worker batch', async () => {
  const server = await smtpServer('250 OK')
  try {
    for (let i = 0; i < 3; i++) await queued('WHATSAPP')
    env(server.port)
    const id = await queued()
    expect(await processNotificationOutbox(now, 1)).toBe(2)
    expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]).toMatchObject({ state: 'SENT' })
    expect(server.messages).toHaveLength(1)
  } finally { await server.close() }
})

it('prefers admin SMTP over environment when delivering', async () => {
  const server = await smtpServer('250 OK')
  try {
    Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', SMTP_SECURE: 'false', SMTP_FROM: 'env@example.test' })
    await saveSmtpSettings({ id: randomUUID(), roles: ['ADMIN'] }, { host: '127.0.0.1', port: server.port, security: 'NONE', username: '', password: '', fromName: 'Clínica', fromAddress: 'clinic@example.test' })
    const id = await queued()
    expect(await deliver(id, now)).toEqual({ id, status: 'SENT' })
    expect(server.messages).toHaveLength(1)
  } finally { await server.close() }
})
