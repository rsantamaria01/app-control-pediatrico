import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createServer, type Socket } from 'node:net'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { and, eq } from 'drizzle-orm'
import { Pool } from 'pg'
import { account, auditEvent, guardianGrant, patient, setupToken, user, userRole, visit, visitResult, visitText } from '../../server/db/schema'
import type { Actor } from '../../shared/types/access'

const configured = process.env.TEST_DATABASE_URL
if (!configured || new URL(configured).pathname !== '/pediatrico_auth_slice2_test' || configured === process.env.DATABASE_URL) throw new Error('Dedicated auth test database required')
const name = `pediatrico_guardian_${randomUUID().replace(/-/g, '')}`
const target = new URL(configured)
target.pathname = `/${name}`
const admin = new URL(configured)
admin.pathname = '/postgres'
const adminPool = new Pool({ connectionString: admin.href })
const pool = new Pool({ connectionString: target.href })
const db = drizzle(pool)
const previous = process.env.DATABASE_URL
const sockets = new Set<Socket>()
const mails: string[] = []
let failDelivery = false
let collecting = false
let content = ''
const smtp = createServer((socket) => {
  sockets.add(socket)
  socket.on('close', () => sockets.delete(socket))
  socket.write('220 mail.test ESMTP\r\n')
  socket.on('data', (chunk) => {
    const text = chunk.toString()
    if (collecting) {
      content += text
      if (content.endsWith('\r\n.\r\n')) {
        collecting = false
        mails.push(content)
        socket.write('250 Accepted\r\n')
      }
    } else if (text.startsWith('EHLO')) socket.write('250 mail.test\r\n')
    else if (text.startsWith('RCPT TO')) socket.write(failDelivery ? '550 Rejected\r\n' : '250 OK\r\n')
    else if (text.startsWith('MAIL FROM')) socket.write('250 OK\r\n')
    else if (text.startsWith('DATA')) {
      content = ''
      collecting = true
      socket.write('354 Continue\r\n')
    } else if (text.startsWith('QUIT')) socket.end('221 Bye\r\n')
  })
})
const doctor: Actor = { id: randomUUID(), roles: ['DOCTOR'] }
const assistant: Actor = { id: randomUUID(), roles: ['ASSISTANT'] }
const adminActor: Actor = { id: randomUUID(), roles: ['ADMIN'] }
const guardianId = randomUUID()
const otherId = randomUUID()
const first = randomUUID()
const second = randomUUID()
let created = false

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${name}"`)
  created = true
  process.env.DATABASE_URL = target.href
  await migrate(db, { migrationsFolder: './server/db/migrations' })
  await new Promise<void>(resolve => smtp.listen(0, '127.0.0.1', resolve))
  process.env.SMTP_HOST = '127.0.0.1'
  process.env.SMTP_PORT = String((smtp.address() as { port: number }).port)
  process.env.SMTP_SECURE = 'false'
  process.env.SMTP_FROM = 'test@localhost'
  process.env.NUXT_PUBLIC_SITE_URL = 'http://localhost:3000'
  await db.insert(patient).values([
    { id: first, name: 'Niña A', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id },
    { id: second, name: 'Niño B', birthDate: '2019-01-01', sex: 'MALE', createdBy: doctor.id }
  ])
  await db.insert(user).values([{ id: otherId, name: 'Otra familia', email: 'other-guardian@example.test', username: 'other-guardian' }])
  await db.insert(userRole).values({ userId: otherId, role: 'PATIENT' })
}, 120000)
afterAll(async () => {
  process.env.DATABASE_URL = previous
  await pool.end()
  const { useDb } = await import('../../server/utils/db')
  await useDb().$client.end()
  for (const socket of sockets) socket.destroy()
  await new Promise<void>(resolve => smtp.close(() => resolve()))
  try {
    if (created) await adminPool.query(`DROP DATABASE "${name}"`)
  } finally {
    await adminPool.end()
  }
})

function latestToken() {
  const token = mails.at(-1)?.match(/invitacion\/([a-zA-Z0-9_-]{32,})/)?.[1]
  expect(token).toBeTruthy()
  return token!
}

async function seedVisit(patientId: string) {
  const id = randomUUID()
  await db.insert(visit).values({ id, patientId, requestId: randomUUID(), requestDigest: 'fixture', measuredAt: new Date('2025-01-01T12:00:00Z'), weightKg: '9', lengthHeightCm: '75', position: 'RECUMBENT', headCircumferenceCm: '45', bmi: '16', correctionUntilMonths: 24, authorId: doctor.id })
  await db.insert(visitText).values({ visitId: id, privateNote: 'PRIVATE_SECRET', parentAdvice: 'Conversar en consulta', clinicianTrend: 'PRIVATE_TREND' })
  await db.insert(visitResult).values({ id: randomUUID(), visitId: id, indicator: 'WEIGHT_FOR_AGE', snapshot: { status: 'unavailable', reason: 'Referencia no disponible' }, calculatedBy: doctor.id })
  return id
}

describe('verified guardian isolation', () => {
  it('requires proof and staff authority, exposes only assistant-safe identity and invitation status', async () => {
    const { grantGuardian, listGrantCandidates } = await import('../../server/services/invitations')
    await expect(grantGuardian(adminActor, first, { name: 'Madre A', email: 'mother-a@example.test', proof: 'Documento verificado presencialmente' })).rejects.toThrow()
    await expect(grantGuardian(assistant, first, { name: 'Madre A', email: 'mother-a@example.test', proof: '' })).rejects.toThrow()
    await seedVisit(first)
    const candidates = await listGrantCandidates(assistant, 'Niña A')
    expect(candidates).toEqual([{ id: first, name: 'Niña A', guardians: [] }])
    expect(JSON.stringify(candidates)).not.toMatch(/PRIVATE|weightKg|birthDate|clinical/)
    await grantGuardian(assistant, first, { name: 'Madre A', email: 'mother-a@example.test', proof: 'Documento verificado presencialmente' })
    const pending = await listGrantCandidates(assistant, 'Niña A')
    expect(pending[0]?.guardians).toEqual([{ email: 'mother-a@example.test', status: 'PENDING' }])
    const [entry] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, first))
    expect(entry).toMatchObject({ verifiedBy: assistant.id, proof: 'Documento verificado presencialmente', status: 'PENDING' })
    expect(entry?.verifiedAt).toBeInstanceOf(Date)
    const [token] = await db.select().from(setupToken).where(eq(setupToken.userId, entry!.guardianId))
    expect(token?.expiresAt.getTime() - Date.now()).toBeGreaterThan(6 * 86400000)
    expect(token?.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(7 * 86400000)
    expect((await db.select().from(auditEvent).where(eq(auditEvent.subjectId, first))).some(row => row.action === 'GUARDIAN_GRANT' && row.outcome === 'ALLOWED')).toBe(true)
  })

  it('activates only the linked child on setup and denies guessed IDs and staff clinical reads', async () => {
    const { setupCredential } = await import('../../server/services/invitation')
    const { getShareableChild, listShareableChildren } = await import('../../server/services/invitations')
    await expect(getShareableChild({ id: guardianId, roles: ['PATIENT'] }, first)).rejects.toThrow()
    const token = latestToken()
    expect(await setupCredential(token, 'mother-unique', 'a sufficiently unique passphrase')).toBe(true)
    expect(await setupCredential(token, 'mother-another', 'another long unique phrase')).toBe(false)
    const [grant] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, first))
    expect(grant?.status).toBe('ACTIVE')
    const guardian: Actor = { id: grant!.guardianId, roles: ['PATIENT'] }
    expect((await listShareableChildren(guardian)).map(item => item.id)).toEqual([first])
    const own = await getShareableChild(guardian, first)
    expect(own.name).toBe('Niña A')
    expect(own.visits[0]?.parentAdvice).toBe('Conversar en consulta')
    expect(own.visits[0]?.results[0]?.status).toBe('unavailable')
    expect(JSON.stringify(own)).not.toMatch(/PRIVATE|authorId|calculatedBy|requestDigest|birthWeightKg/)
    await expect(getShareableChild(guardian, second)).rejects.toThrow()
    await expect(getShareableChild({ id: otherId, roles: ['PATIENT'] }, first)).rejects.toThrow()
    await expect(getShareableChild(assistant, first)).rejects.toThrow()
    await expect(getShareableChild(adminActor, first)).rejects.toThrow()
    expect((await db.select().from(auditEvent).where(and(eq(auditEvent.actorId, otherId), eq(auditEvent.action, 'PORTAL_READ')))).some(row => row.outcome === 'DENIED')).toBe(true)
  })

  it('leaves failed delivery pending, retries independently and revokes a relationship immediately', async () => {
    const { grantGuardian, revokeGuardian, getShareableChild } = await import('../../server/services/invitations')
    failDelivery = true
    try {
      await grantGuardian(doctor, second, { name: 'Madre B', email: 'mother-b@example.test', proof: 'Documento verificado' })
    } finally {
      failDelivery = false
    }
    const [failed] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, second))
    expect(failed?.status).toBe('FAILED')
    expect((await db.select().from(auditEvent).where(eq(auditEvent.subjectId, second))).some(row => row.action === 'GUARDIAN_DELIVERY_FAILED')).toBe(true)
    await grantGuardian(doctor, second, { name: 'Madre B', email: 'mother-b@example.test', proof: 'Documento verificado' })
    const token = latestToken()
    const { setupCredential } = await import('../../server/services/invitation')
    expect(await setupCredential(token, 'mother-b-unique', 'a sufficiently unique passphrase')).toBe(true)
    const guardian: Actor = { id: failed!.guardianId, roles: ['PATIENT'] }
    expect((await getShareableChild(guardian, second)).id).toBe(second)
    await revokeGuardian(doctor, second, failed!.guardianId)
    await expect(getShareableChild(guardian, second)).rejects.toThrow()
    expect((await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, second)))[0]?.status).toBe('REVOKED')
  })

  it('does not publish unverified available snapshots or unsupported ages', async () => {
    const { getShareableChild } = await import('../../server/services/invitations')
    const [link] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, first))
    const guardian: Actor = { id: link!.guardianId, roles: ['PATIENT'] }
    const [initial] = await db.select({ id: visit.id }).from(visit).where(eq(visit.patientId, first))
    await db.insert(visitResult).values({ id: randomUUID(), visitId: initial!.id, indicator: 'HEIGHT_FOR_AGE', snapshot: { status: 'available', z: -2.41, percentile: 0.8 }, calculatedBy: doctor.id })
    expect((await getShareableChild(guardian, first)).visits[0]?.results.find(result => result.indicator === 'HEIGHT_FOR_AGE')).toEqual({ indicator: 'HEIGHT_FOR_AGE', status: 'unavailable' })
    const old = randomUUID()
    await db.insert(patient).values({ id: old, name: 'Mayor', birthDate: '2018-01-01', sex: 'MALE', createdBy: doctor.id })
    await db.insert(guardianGrant).values({ patientId: old, guardianId: guardian.id, contactEmail: 'mother-a@example.test', proof: 'Documento verificado', verifiedBy: doctor.id, status: 'ACTIVE' })
    const visitId = await seedVisit(old)
    await db.insert(visitResult).values({ id: randomUUID(), visitId, indicator: 'WEIGHT_FOR_AGE', snapshot: { status: 'available', z: 1.3, percentile: 90, reference: { standard: 'WHO_2006' } }, calculatedBy: doctor.id })
    expect((await getShareableChild(guardian, old)).visits[0]?.results.every(result => result.status === 'unavailable')).toBe(true)
  })

  it('does not silently activate an existing account after rejected delivery', async () => {
    const { grantGuardian, getShareableChild } = await import('../../server/services/invitations')
    const [owner] = await db.select().from(user).where(eq(user.email, 'mother-a@example.test'))
    const childId = randomUUID()
    await db.insert(patient).values({ id: childId, name: 'Fallo entrega', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
    failDelivery = true
    try {
      expect((await grantGuardian(doctor, childId, { name: 'Madre A', email: 'mother-a@example.test', proof: 'Documento verificado' })).status).toBe('FAILED')
    } finally {
      failDelivery = false
    }
    await expect(getShareableChild({ id: owner!.id, roles: ['PATIENT'] }, childId)).rejects.toThrow()
  })

  it('bounds pending invitations to the intended relationship and never grants a different child on setup', async () => {
    const { grantGuardian, getShareableChild, revokeGuardian } = await import('../../server/services/invitations')
    const { setupCredential } = await import('../../server/services/invitation')
    const unlinked = randomUUID()
    await db.insert(patient).values({ id: unlinked, name: 'No vinculado', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
    const email = `${randomUUID()}@example.test`
    await grantGuardian(assistant, unlinked, { name: 'Representante', email, proof: 'Verificación presencial' })
    const token = latestToken()
    const [link] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, unlinked))
    await revokeGuardian(assistant, unlinked, link!.guardianId)
    expect(await setupCredential(token, `revoked-${randomUUID().slice(0, 8)}`, 'a sufficiently unique passphrase')).toBe(false)
    await expect(getShareableChild({ id: link!.guardianId, roles: ['PATIENT'] }, unlinked)).rejects.toThrow()
  })

  it('grants an existing guardian without resetting credentials or granting any other child', async () => {
    const { grantGuardian, getShareableChild } = await import('../../server/services/invitations')
    const third = randomUUID()
    await db.insert(patient).values({ id: third, name: 'Niño C', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
    const [owner] = await db.select().from(user).where(eq(user.email, 'mother-a@example.test'))
    const [credential] = await db.select().from(account).where(eq(account.userId, owner!.id))
    await grantGuardian(doctor, third, { name: 'Madre A', email: 'mother-a@example.test', proof: 'Documento verificado' })
    const [unchanged] = await db.select().from(account).where(eq(account.userId, owner!.id))
    expect(unchanged?.password).toBe(credential?.password)
    expect((await getShareableChild({ id: owner!.id, roles: ['PATIENT'] }, third)).id).toBe(third)
    await expect(getShareableChild({ id: otherId, roles: ['PATIENT'] }, third)).rejects.toThrow()
  })
})
