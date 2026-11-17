import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { and, eq, sql } from 'drizzle-orm'
import { Pool } from 'pg'
import type { Actor } from '../../shared/types/access'
import { guardianGrant, guardianPhone, individualCheckup, notificationAttempt, notificationOutbox, notificationPreference, patient, user } from '../../server/db/schema'
import { whatsappHealth, whatsappSettings } from '../../server/db/schema/notifications'
import { deliver, processNotificationOutbox, providerStatus, queueNotification } from '../../server/services/outbox'
import { getWhatsAppSettings, resolveWhatsAppTransport, saveWhatsAppSettings } from '../../server/services/whatsapp-settings'

const source = process.env.DATABASE_URL
if (!source || !new URL(source).pathname.includes('pediatrico')) throw new Error('Dedicated pediatric test server required')
const name = `pediatrico_whatsapp_${randomUUID().replaceAll('-', '')}`
const adminUrl = new URL(source)
adminUrl.pathname = '/postgres'
const target = new URL(source)
target.pathname = `/${name}`
const adminPool = new Pool({ connectionString: adminUrl.href })
const pool = new Pool({ connectionString: target.href })
const db = drizzle(pool)
const priorUrl = process.env.DATABASE_URL
const vars = ['WHATSAPP_CONFIG_KEY', 'WHATSAPP_PROVIDER', 'WHATSAPP_META_TOKEN', 'WHATSAPP_META_PHONE_NUMBER_ID', 'WHATSAPP_META_TEMPLATE', 'WHATSAPP_META_LANGUAGE', 'WHATSAPP_TWILIO_ACCOUNT_SID', 'WHATSAPP_TWILIO_AUTH_TOKEN', 'WHATSAPP_TWILIO_FROM', 'WHATSAPP_TWILIO_CONTENT_SID'] as const
const priorEnv = Object.fromEntries(vars.map(key => [key, process.env[key]]))
const admin: Actor = { id: randomUUID(), roles: ['ADMIN'] }
const guardian: Actor = { id: randomUUID(), roles: ['PATIENT'] }
const other: Actor = { id: randomUUID(), roles: ['PATIENT'] }
const child = randomUUID()
const checkup = randomUUID()
const now = new Date('2027-03-01T15:00:00Z')
const meta = { provider: 'META' as const, sender: '123456789', template: 'control_due', language: 'es', secret: 'meta-private-token' }
const twilio = { provider: 'TWILIO' as const, sender: '+15551234567', accountSid: `AC${'a'.repeat(32)}`, template: `HX${'b'.repeat(32)}`, secret: 'twilio-private-token' }
let created = false

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${name}"`)
  created = true
  process.env.DATABASE_URL = target.href
  await migrate(db, { migrationsFolder: './server/db/migrations' })
  await db.insert(user).values([{ id: guardian.id, name: 'Familia', email: 'family@example.test' }, { id: other.id, name: 'Otra', email: 'other@example.test' }])
  await db.insert(patient).values({ id: child, name: 'Paciente', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: admin.id })
  await db.insert(guardianGrant).values({ patientId: child, guardianId: guardian.id, contactEmail: 'family@example.test', contactPhone: '+593991234567', proof: 'verified', verifiedBy: admin.id, status: 'ACTIVE' })
  await db.insert(guardianPhone).values({ guardianId: guardian.id, phone: '+593991234567' })
}, 120000)

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE completed_checkup, individual_checkup, notification_attempt, in_app_notice, notification_outbox, notification_preference, whatsapp_settings, whatsapp_health, audit_event RESTART IDENTITY CASCADE`)
  await db.update(guardianGrant).set({ status: 'ACTIVE', contactPhone: '+593991234567' }).where(eq(guardianGrant.patientId, child))
  await db.update(guardianPhone).set({ phone: '+593991234567' }).where(eq(guardianPhone.guardianId, guardian.id))
  await db.insert(individualCheckup).values({ id: checkup, patientId: child, date: '2027-03-01', reason: 'Revisión', authorId: admin.id })
  for (const key of vars) Reflect.deleteProperty(process.env, key)
  process.env.WHATSAPP_CONFIG_KEY = 'b2'.repeat(32)
  vi.unstubAllGlobals()
})

afterAll(async () => {
  process.env.DATABASE_URL = priorUrl
  for (const key of vars) {
    if (priorEnv[key] === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = priorEnv[key]
  }
  vi.unstubAllGlobals()
  await pool.end()
  const { useDb } = await import('../../server/utils/db')
  await useDb().$client.end()
  try {
    if (created) await adminPool.query(`DROP DATABASE "${name}"`)
  } finally {
    await adminPool.end()
  }
})

async function queued() {
  return db.transaction(tx => queueNotification(tx, { kind: 'CHECKUP_DUE', subjectId: checkup }, { channel: 'WHATSAPP', userId: guardian.id, address: '+593991234567' }))
}

it('restricts admin settings and encrypts, redacts and audits the selected provider', async () => {
  await expect(saveWhatsAppSettings(other, meta)).rejects.toThrow()
  const view = await saveWhatsAppSettings(admin, meta)
  expect(view).toMatchObject({ source: 'ADMIN', provider: 'META', configured: true, sender: meta.sender, template: meta.template })
  const [row] = await db.select().from(whatsappSettings)
  expect(row!.encryptedSecret).not.toContain(meta.secret)
  expect(JSON.stringify(await getWhatsAppSettings())).not.toContain(meta.secret)
  expect(JSON.stringify(view)).not.toContain(row!.encryptedSecret)
  expect(await resolveWhatsAppTransport()).toMatchObject(meta)
  const audit = await db.execute(sql`SELECT action, actor_id FROM audit_event`)
  expect(audit.rows).toMatchObject([{ action: 'WHATSAPP_SETTINGS_UPDATE', actor_id: admin.id }])
  expect(JSON.stringify(audit.rows)).not.toContain(meta.secret)
})

it('prefers explicit environment selection to admin configuration and fails closed on incomplete environment', async () => {
  await saveWhatsAppSettings(admin, meta)
  Object.assign(process.env, { WHATSAPP_PROVIDER: 'TWILIO', WHATSAPP_TWILIO_ACCOUNT_SID: twilio.accountSid, WHATSAPP_TWILIO_AUTH_TOKEN: twilio.secret, WHATSAPP_TWILIO_FROM: twilio.sender, WHATSAPP_TWILIO_CONTENT_SID: twilio.template })
  expect(await resolveWhatsAppTransport()).toMatchObject(twilio)
  expect(await getWhatsAppSettings()).toMatchObject({ source: 'ENV', provider: 'TWILIO', configured: true })
  expect(JSON.stringify(await getWhatsAppSettings())).not.toContain(twilio.secret)
  delete process.env.WHATSAPP_TWILIO_AUTH_TOKEN
  expect(await resolveWhatsAppTransport()).toBeNull()
  expect(await providerStatus('WHATSAPP')).toBe('NOT_CONFIGURED')
  expect(await getWhatsAppSettings()).toMatchObject({ source: 'ENV', configured: false })
})

it('rejects empty and whitespace-only credentials without persisting an apparently ready provider', async () => {
  await expect(saveWhatsAppSettings(admin, { ...meta, secret: '   ' })).rejects.toThrow()
  expect(await db.select().from(whatsappSettings)).toHaveLength(0)
  Object.assign(process.env, { WHATSAPP_PROVIDER: 'META', WHATSAPP_META_TOKEN: '   ', WHATSAPP_META_PHONE_NUMBER_ID: meta.sender, WHATSAPP_META_TEMPLATE: meta.template, WHATSAPP_META_LANGUAGE: meta.language })
  expect(await providerStatus('WHATSAPP')).toBe('NOT_CONFIGURED')
})

it('requires a new secret when switching provider and fails closed if encryption key is missing', async () => {
  await saveWhatsAppSettings(admin, meta)
  await expect(saveWhatsAppSettings(admin, { ...twilio, secret: '' })).rejects.toThrow()
  delete process.env.WHATSAPP_CONFIG_KEY
  await expect(resolveWhatsAppTransport()).rejects.toThrow()
  await expect(saveWhatsAppSettings(admin, { ...meta, secret: '' })).rejects.toThrow()
  expect(await getWhatsAppSettings()).toMatchObject({ configured: false, provider: 'META' })
  expect(await providerStatus('WHATSAPP')).toBe('NOT_CONFIGURED')
  expect((await db.select().from(whatsappSettings))[0]?.provider).toBe('META')
  process.env.WHATSAPP_CONFIG_KEY = 'c3'.repeat(32)
  expect(await getWhatsAppSettings()).toMatchObject({ configured: false })
  expect(await providerStatus('WHATSAPP')).toBe('NOT_CONFIGURED')
})

it('selects Twilio when configured and reports recovery only after a successful send', async () => {
  await saveWhatsAppSettings(admin, twilio)
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'WHATSAPP', enabled: true })
  const send = vi.fn()
    .mockResolvedValueOnce(new Response('{}', { status: 400 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ sid: 'SMaccepted', status: 'queued' }), { status: 201 }))
  vi.stubGlobal('fetch', send)
  expect(await deliver(await queued(), now)).toMatchObject({ status: 'FAILED' })
  expect(await providerStatus('WHATSAPP')).toBe('FAILED')
  const second = randomUUID()
  await db.insert(individualCheckup).values({ id: second, patientId: child, date: '2027-03-01', reason: 'Seguimiento', authorId: admin.id })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'CHECKUP_DUE', subjectId: second }, { channel: 'WHATSAPP', userId: guardian.id, address: '+593991234567' }))
  expect(await deliver(id, now)).toMatchObject({ status: 'ACCEPTED' })
  expect(await providerStatus('WHATSAPP')).toBe('READY')
  expect(send).toHaveBeenCalledTimes(2)
})

it('rechecks a changed verified number before sending rather than redirecting the notice', async () => {
  await saveWhatsAppSettings(admin, meta)
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'WHATSAPP', enabled: true })
  const id = await queued()
  await db.update(guardianPhone).set({ phone: '+593998888888' }).where(eq(guardianPhone.guardianId, guardian.id))
  const send = vi.fn()
  vi.stubGlobal('fetch', send)
  expect(await deliver(id, now)).toMatchObject({ status: 'OPTED_OUT' })
  expect(send).not.toHaveBeenCalled()
})

it('rejects a wrong-channel test adapter without claiming a WhatsApp delivery', async () => {
  await saveWhatsAppSettings(admin, meta)
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'WHATSAPP', enabled: true })
  const id = await queued()
  const send = vi.fn(async () => 'SENT' as const)
  expect(await deliver(id, now, { channel: 'EMAIL', status: () => 'READY', send })).toMatchObject({ status: 'NOT_CONFIGURED' })
  expect(send).not.toHaveBeenCalled()
})

it('refuses delivery when the patient grant phone differs from the account verified phone', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'WHATSAPP', enabled: true })
  await db.update(guardianGrant).set({ contactPhone: '+593998888888' }).where(eq(guardianGrant.patientId, child))
  await expect(queued()).rejects.toThrow()
  await db.update(guardianGrant).set({ contactPhone: '+593991234567' }).where(eq(guardianGrant.patientId, child))
  const id = await queued()
  await db.update(guardianGrant).set({ contactPhone: '+593998888888' }).where(eq(guardianGrant.patientId, child))
  expect(await deliver(id, now)).toMatchObject({ status: 'OPTED_OUT' })
})

it('retries a definite provider rate limit at most three times, without duplicate acceptance', async () => {
  await saveWhatsAppSettings(admin, meta)
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'WHATSAPP', enabled: true })
  const send = vi.fn(async () => new Response('{}', { status: 429 }))
  vi.stubGlobal('fetch', send)
  const id = await queued()
  expect(await deliver(id, now)).toMatchObject({ status: 'RETRY' })
  expect(await deliver(id, new Date(now.getTime() + 60000))).toMatchObject({ status: 'RETRY' })
  expect(await deliver(id, new Date(now.getTime() + 180000))).toMatchObject({ status: 'FAILED' })
  expect(await deliver(id, new Date(now.getTime() + 600000))).toMatchObject({ status: 'FAILED' })
  expect(send).toHaveBeenCalledTimes(3)
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]).toMatchObject({ state: 'FAILED', deliveredAt: null, errorClass: 'RetryExhausted' })
})

it('does not carry a failed health state across credential rotation', async () => {
  await saveWhatsAppSettings(admin, meta)
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'WHATSAPP', enabled: true })
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
  expect(await deliver(await queued(), now)).toMatchObject({ status: 'FAILED' })
  expect(await providerStatus('WHATSAPP')).toBe('FAILED')
  await saveWhatsAppSettings(admin, { ...meta, secret: 'replacement-token' })
  expect(await providerStatus('WHATSAPP')).toBe('READY')
})

it('queues only verified, consented guardians and never stores a clear-text number', async () => {
  await expect(queued()).rejects.toThrow()
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'WHATSAPP', enabled: true })
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'CHECKUP_DUE', subjectId: checkup }, { channel: 'WHATSAPP', userId: other.id, address: '+593991234567' }))).rejects.toThrow()
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: checkup }, { channel: 'WHATSAPP', userId: guardian.id, address: '+593991234567' }))).rejects.toThrow()
  const id = await queued()
  expect(await queued()).toBe(id)
  expect(JSON.stringify(await db.select().from(notificationOutbox))).not.toContain('+593991234567')
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  expect(await deliver(id, now)).toMatchObject({ status: 'OPTED_OUT' })
})

it('parks unconfigured WhatsApp without affecting in-app, and resumes only its own channel after setup', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'WHATSAPP', enabled: true })
  const id = await queued()
  const inApp = await db.transaction(tx => queueNotification(tx, { kind: 'CHECKUP_DUE', subjectId: checkup }, { channel: 'IN_APP', userId: guardian.id }))
  expect(await deliver(id, now)).toMatchObject({ status: 'NOT_CONFIGURED' })
  expect(await deliver(inApp, now)).toMatchObject({ status: 'SENT' })
  expect(await providerStatus('WHATSAPP')).toBe('NOT_CONFIGURED')
  const send = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.accepted' }] }), { status: 200 }))
  vi.stubGlobal('fetch', send)
  await saveWhatsAppSettings(admin, meta)
  expect(await processNotificationOutbox(now)).toBe(1)
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]).toMatchObject({ state: 'ACCEPTED', deliveredAt: null })
  expect(await providerStatus('WHATSAPP')).toBe('READY')
  expect(send).toHaveBeenCalledTimes(1)
  expect(await processNotificationOutbox(now)).toBe(0)
})

it('delivers only at 08:00–20:00 local time and suppresses opt-out before transport', async () => {
  await saveWhatsAppSettings(admin, meta)
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'WHATSAPP', enabled: true })
  const send = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.accepted' }] }), { status: 200 }))
  vi.stubGlobal('fetch', send)
  const id = await queued()
  expect(await deliver(id, new Date('2027-03-01T12:59:00Z'))).toMatchObject({ status: 'DEFERRED' })
  expect(send).not.toHaveBeenCalled()
  expect(await deliver(id, new Date('2027-03-01T13:00:00Z'))).toMatchObject({ status: 'ACCEPTED' })
  const evening = randomUUID()
  await db.insert(individualCheckup).values({ id: evening, patientId: child, date: '2027-03-01', reason: 'Control vespertino', authorId: admin.id })
  const eveningId = await db.transaction(tx => queueNotification(tx, { kind: 'CHECKUP_DUE', subjectId: evening }, { channel: 'WHATSAPP', userId: guardian.id, address: '+593991234567' }))
  expect(await deliver(eveningId, new Date('2027-03-02T01:00:00Z'))).toMatchObject({ status: 'DEFERRED' })
  expect(send).toHaveBeenCalledTimes(1)
  const second = randomUUID()
  await db.insert(individualCheckup).values({ id: second, patientId: child, date: '2027-03-01', reason: 'Seguimiento', authorId: admin.id })
  const next = await db.transaction(tx => queueNotification(tx, { kind: 'CHECKUP_DUE', subjectId: second }, { channel: 'WHATSAPP', userId: guardian.id, address: '+593991234567' }))
  await db.update(notificationPreference).set({ enabled: false }).where(and(eq(notificationPreference.userId, guardian.id), eq(notificationPreference.channel, 'WHATSAPP')))
  expect(await deliver(next, new Date('2027-03-01T14:00:00Z'))).toMatchObject({ status: 'OPTED_OUT' })
  expect(send).toHaveBeenCalledTimes(1)
})

it('never retries uncertain provider outcomes and persists failure health without leaking secrets', async () => {
  await saveWhatsAppSettings(admin, twilio)
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'WHATSAPP', enabled: true })
  const send = vi.fn(async () => {
    throw new Error('private-network-error')
  })
  vi.stubGlobal('fetch', send)
  const id = await queued()
  expect(await deliver(id, now)).toMatchObject({ status: 'FAILED' })
  expect(await providerStatus('WHATSAPP')).toBe('FAILED')
  expect(await deliver(id, now)).toMatchObject({ status: 'FAILED' })
  expect(await processNotificationOutbox(now)).toBe(0)
  expect(send).toHaveBeenCalledTimes(1)
  expect((await db.select().from(notificationAttempt).where(eq(notificationAttempt.outboxId, id)))[0]).toMatchObject({ outcome: 'FAILED' })
  expect(await db.select().from(whatsappHealth)).toMatchObject([{ state: 'FAILING' }])
  expect(JSON.stringify(await db.select().from(notificationAttempt))).not.toContain('private-network-error')
})
