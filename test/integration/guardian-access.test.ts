import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createServer, type Socket } from 'node:net'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { and, eq } from 'drizzle-orm'
import { Pool } from 'pg'
import { account, auditEvent, guardianDelivery, guardianGrant, guardianPhone, patient, setupToken, user, userRole, visit, visitResult, visitText } from '../../server/db/schema'
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
  process.env.RECOVERY_QUEUE_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
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

async function seedVisit(patientId: string, shareWithFamily = true) {
  const id = randomUUID()
  await db.insert(visit).values({ id, patientId, requestId: randomUUID(), requestDigest: 'fixture', measuredAt: new Date('2025-01-01T12:00:00Z'), weightKg: '9', lengthHeightCm: '75', position: 'RECUMBENT', headCircumferenceCm: '45', bmi: '16', correctionUntilMonths: 24, authorId: doctor.id, shareWithFamily })
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
    const { getGrantCandidate } = await import('../../server/services/invitations')
    expect(await getGrantCandidate(assistant, first)).toEqual({ id: first, name: 'Niña A', guardians: [] })
    await expect(getGrantCandidate(adminActor, first)).rejects.toThrow()
    await grantGuardian(assistant, first, { name: 'Madre A', email: 'mother-a@example.test', proof: 'Documento verificado presencialmente' })
    const pending = await listGrantCandidates(assistant, 'Niña A')
    expect(pending[0]?.guardians).toEqual([{ email: 'mother-a@example.test', status: 'PENDING', lastSendError: null }])
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
    expect(own.visits[0]).not.toHaveProperty('results')
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
    expect(failed?.lastSendError).toBe('Error')
    expect((await db.select().from(auditEvent).where(eq(auditEvent.subjectId, second))).some(row => row.action === 'GUARDIAN_DELIVERY_FAILED')).toBe(true)
    await grantGuardian(doctor, second, { name: 'Madre B', email: 'mother-b@example.test', proof: 'Documento verificado', confirmedGuardianId: failed!.guardianId })
    const token = latestToken()
    const { setupCredential } = await import('../../server/services/invitation')
    expect(await setupCredential(token, 'mother-b-unique', 'a sufficiently unique passphrase')).toBe(true)
    const guardian: Actor = { id: failed!.guardianId, roles: ['PATIENT'] }
    expect((await getShareableChild(guardian, second)).id).toBe(second)
    await revokeGuardian(doctor, second, failed!.guardianId)
    await expect(getShareableChild(guardian, second)).rejects.toThrow()
    expect((await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, second)))[0]?.status).toBe('REVOKED')
  })

  it('persists doctor sharing defaults and a known next-control time while rejecting inverted dates', async () => {
    const { createVisit } = await import('../../server/services/visits')
    const { visitSchema } = await import('../../shared/types/measurement')
    const input = { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00.000Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT' as const, headCircumferenceCm: 45, shareWithFamily: false, nextControlAt: '2025-02-01T14:30:00.000Z', parentAdvice: 'Volver en febrero', privateNote: 'ONLY_DOCTOR' }
    expect(() => visitSchema.parse({ ...input, nextControlAt: '2024-12-01T12:00:00.000Z' })).toThrow()
    const stored = await createVisit(doctor, first, input)
    expect(stored.shareWithFamily).toBe(false)
    expect(stored.nextControlAt).toBe('2025-02-01T14:30:00.000Z')
    const [link] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, first))
    const guardian: Actor = { id: link!.guardianId, roles: ['PATIENT'] }
    const { getShareableChild, setVisitSharing } = await import('../../server/services/invitations')
    expect((await getShareableChild(guardian, first)).visits.some(item => item.parentAdvice === 'Volver en febrero')).toBe(false)
    await setVisitSharing(doctor, first, stored.id, true)
    expect((await getShareableChild(guardian, first)).visits.find(item => item.parentAdvice === 'Volver en febrero')?.nextControlAt).toBe('2025-02-01T14:30:00.000Z')
  })

  it('lets only a doctor change visit sharing without mutating the clinical snapshot', async () => {
    const { setVisitSharing, getShareableChild } = await import('../../server/services/invitations')
    const [link] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, first))
    const guardian: Actor = { id: link!.guardianId, roles: ['PATIENT'] }
    const [original] = await db.select({ id: visit.id }).from(visit).leftJoin(visitText, eq(visitText.visitId, visit.id)).where(and(eq(visit.patientId, first), eq(visitText.parentAdvice, 'Volver en febrero')))
    await expect(setVisitSharing(assistant, first, original!.id, false)).rejects.toThrow()
    await expect(setVisitSharing({ id: otherId, roles: ['PATIENT'] }, first, original!.id, false)).rejects.toThrow()
    await setVisitSharing(doctor, first, original!.id, false)
    expect((await getShareableChild(guardian, first)).visits.some(item => item.parentAdvice === 'Volver en febrero')).toBe(false)
    await setVisitSharing(doctor, first, original!.id, true)
    expect((await getShareableChild(guardian, first)).visits.some(item => item.parentAdvice === 'Volver en febrero')).toBe(true)
  })

  it('only projects doctor-shared visits and never sends growth interpretations to families', async () => {
    const { getShareableChild, listShareableChildren } = await import('../../server/services/invitations')
    const [link] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, first))
    const guardian: Actor = { id: link!.guardianId, roles: ['PATIENT'] }
    await seedVisit(first, false)
    const own = await getShareableChild(guardian, first)
    expect(own.visits.some(item => item.parentAdvice === 'Volver en febrero')).toBe(true)
    expect(JSON.stringify(own)).not.toMatch(/results|percentile|"z"|bmi|PRIVATE_SECRET/)
    const cards = await listShareableChildren(guardian)
    expect(cards.find(child => child.id === first)?.lastControl?.parentAdvice).toBe('Volver en febrero')
    expect(JSON.stringify(cards)).not.toMatch(/results|percentile|"z"|bmi|PRIVATE_SECRET/)
  })

  it('does not publish unverified available snapshots or unsupported ages', async () => {
    const { getShareableChild } = await import('../../server/services/invitations')
    const [link] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, first))
    const guardian: Actor = { id: link!.guardianId, roles: ['PATIENT'] }
    const [initial] = await db.select({ id: visit.id }).from(visit).where(eq(visit.patientId, first))
    await db.insert(visitResult).values({ id: randomUUID(), visitId: initial!.id, indicator: 'HEIGHT_FOR_AGE', snapshot: { status: 'available', z: -2.41, percentile: 0.8 }, calculatedBy: doctor.id })
    expect(JSON.stringify(await getShareableChild(guardian, first))).not.toMatch(/HEIGHT_FOR_AGE|percentile|"z"/)
    const old = randomUUID()
    await db.insert(patient).values({ id: old, name: 'Mayor', birthDate: '2018-01-01', sex: 'MALE', createdBy: doctor.id })
    await db.insert(guardianGrant).values({ patientId: old, guardianId: guardian.id, contactEmail: 'mother-a@example.test', proof: 'Documento verificado', verifiedBy: doctor.id, status: 'ACTIVE' })
    const visitId = await seedVisit(old)
    await db.insert(visitResult).values({ id: randomUUID(), visitId, indicator: 'WEIGHT_FOR_AGE', snapshot: { status: 'available', z: 1.3, percentile: 90, reference: { standard: 'WHO_2006' } }, calculatedBy: doctor.id })
    expect(JSON.stringify(await getShareableChild(guardian, old))).not.toMatch(/WEIGHT_FOR_AGE|percentile|"z"/)
  })

  it('does not silently activate an existing account after rejected delivery', async () => {
    const { grantGuardian, getShareableChild } = await import('../../server/services/invitations')
    const [owner] = await db.select().from(user).where(eq(user.email, 'mother-a@example.test'))
    const childId = randomUUID()
    await db.insert(patient).values({ id: childId, name: 'Fallo entrega', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
    failDelivery = true
    try {
      expect((await grantGuardian(doctor, childId, { name: 'Madre A', email: 'mother-a@example.test', proof: 'Documento verificado', confirmedGuardianId: owner!.id })).status).toBe('FAILED')
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

  it('keeps the last shared control in the home summary when a newer visit is private', async () => {
    const { listShareableChildren } = await import('../../server/services/invitations')
    const [link] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, first))
    const guardian: Actor = { id: link!.guardianId, roles: ['PATIENT'] }
    const secretId = randomUUID()
    await db.insert(visit).values({ id: secretId, patientId: first, requestId: randomUUID(), requestDigest: 'later', measuredAt: new Date('2026-01-01T12:00:00Z'), weightKg: '11', lengthHeightCm: '80', position: 'STANDING', headCircumferenceCm: '47', bmi: '17', correctionUntilMonths: 24, authorId: doctor.id, shareWithFamily: false })
    await db.insert(visitText).values({ visitId: secretId, privateNote: 'PRIVATE_NEW', parentAdvice: 'NOT_SHARED' })
    const home = await listShareableChildren(guardian)
    expect(home.find(child => child.id === first)?.lastControl?.weightKg).toBe(9)
    expect(JSON.stringify(home)).not.toMatch(/NOT_SHARED|PRIVATE_NEW|"weightKg":11/)
  })

  it('keeps an active sibling link active when a reminder email fails', async () => {
    const { grantGuardian, getShareableChild } = await import('../../server/services/invitations')
    const [owner] = await db.select().from(user).where(eq(user.email, 'mother-a@example.test'))
    const childId = randomUUID()
    await db.insert(patient).values({ id: childId, name: 'Hermano con acceso', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
    await grantGuardian(doctor, childId, { name: 'Madre A', email: 'mother-a@example.test', proof: 'Identidad verificada', confirmedGuardianId: owner!.id })
    failDelivery = true
    try {
      await grantGuardian(doctor, childId, { name: 'Madre A', email: 'mother-a@example.test', proof: 'Identidad verificada', confirmedGuardianId: owner!.id })
    } finally {
      failDelivery = false
    }
    const [retained] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, childId))
    expect(retained?.status).toBe('ACTIVE')
    expect(retained?.lastSendError).toBe('Error')
    expect((await getShareableChild({ id: owner!.id, roles: ['PATIENT'] }, childId)).id).toBe(childId)
  })

  it('requires staff to confirm an existing identity before linking and can resend a pending link', async () => {
    const { grantGuardian, findGuardianIdentity } = await import('../../server/services/invitations')
    const email = 'mother-b@example.test'
    const [existing] = await db.select().from(user).where(eq(user.email, email))
    const match = await findGuardianIdentity(assistant, email)
    expect(match).toMatchObject({ name: 'Madre B', maskedContact: 'm***@e***' })
    expect(JSON.stringify(match)).not.toContain(email)
    await expect(findGuardianIdentity(adminActor, email)).rejects.toThrow()
    const sibling = randomUUID()
    await db.insert(patient).values({ id: sibling, name: 'Hermana B', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
    await expect(grantGuardian(assistant, sibling, { name: 'Madre B', email, proof: 'Identidad verificada' })).rejects.toThrow()
    expect((await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, sibling)))).toHaveLength(0)
    await expect(grantGuardian(assistant, sibling, { name: 'Madre B', email: `${randomUUID()}@example.test`, proof: 'Identidad verificada', confirmedGuardianId: existing!.id })).rejects.toThrow()
    const result = await grantGuardian(assistant, sibling, { name: 'Madre B', email, proof: 'Identidad verificada', confirmedGuardianId: existing!.id })
    expect(result.status).toBe('ACTIVE')
    const fresh = randomUUID()
    await db.insert(patient).values({ id: fresh, name: 'Hermano nuevo', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
    const newEmail = `${randomUUID()}@example.test`
    await grantGuardian(doctor, fresh, { name: 'Nuevo padre', email: newEmail, proof: 'Identidad verificada' })
    const previousToken = latestToken()
    const [newOwner] = await db.select({ id: user.id }).from(user).where(eq(user.email, newEmail))
    await grantGuardian(doctor, fresh, { name: 'Nuevo padre', email: newEmail, proof: 'Identidad verificada', confirmedGuardianId: newOwner!.id })
    const [oldToken] = await db.select().from(setupToken).where(eq(setupToken.digest, (await import('../../server/services/invitation')).tokenDigest(previousToken)))
    expect(oldToken?.usedAt).toBeInstanceOf(Date)
    const [currentLink] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, fresh))
    expect(currentLink?.tokenId).not.toBe(oldToken?.id)
    expect(currentLink?.status).toBe('PENDING')
    const { setupCredential } = await import('../../server/services/invitation')
    expect(await setupCredential(previousToken, 'old-guardian', 'unique passphrase for guardian')).toBe(false)
  })

  it('activates two delivered sibling grants with one setup and excludes revoked or undelivered links', async () => {
    const { grantGuardian, revokeGuardian, getShareableChild, listShareableChildren } = await import('../../server/services/invitations')
    const { setupCredential } = await import('../../server/services/invitation')
    const email = `${randomUUID()}@example.test`
    const children = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
    await db.insert(patient).values(children.map((id, i) => ({ id, name: `Hermano ${i}`, birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })))
    await grantGuardian(doctor, children[0]!, { name: 'Familia compartida', email, proof: 'Identidad presencial' })
    const firstToken = latestToken()
    const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
    await grantGuardian(assistant, children[1]!, { name: 'Familia compartida', email, proof: 'Identidad presencial', confirmedGuardianId: owner!.id })
    const secondToken = latestToken()
    await grantGuardian(assistant, children[2]!, { name: 'Familia compartida', email, proof: 'Identidad presencial', confirmedGuardianId: owner!.id })
    await revokeGuardian(assistant, children[2]!, owner!.id)
    failDelivery = true
    try {
      await grantGuardian(doctor, children[3]!, { name: 'Familia compartida', email, proof: 'Identidad presencial', confirmedGuardianId: owner!.id })
    } finally {
      failDelivery = false
    }
    expect(await setupCredential(secondToken, `sibling-${randomUUID().slice(0, 8)}`, 'unique guardian passphrase')).toBe(true)
    expect(await setupCredential(firstToken, `stale-${randomUUID().slice(0, 8)}`, 'another unique guardian passphrase')).toBe(false)
    const linked = await listShareableChildren({ id: owner!.id, roles: ['PATIENT'] })
    expect(linked.map(child => child.id).sort()).toEqual(children.slice(0, 2).sort())
    await expect(getShareableChild({ id: owner!.id, roles: ['PATIENT'] }, children[2]!)).rejects.toThrow()
    await expect(getShareableChild({ id: owner!.id, roles: ['PATIENT'] }, children[3]!)).rejects.toThrow()
  })

  it('does not email a link if persisting the grant fails', async () => {
    const { grantGuardian } = await import('../../server/services/invitations')
    const childId = randomUUID()
    const email = `${randomUUID()}@example.test`
    await db.insert(patient).values({ id: childId, name: 'Persistencia fallida', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
    const sent = mails.length
    await pool.query(`CREATE FUNCTION reject_guardian_insert() RETURNS trigger AS $$ BEGIN IF NEW.patient_id = '${childId}' THEN RAISE EXCEPTION 'forced grant failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`)
    await pool.query('CREATE TRIGGER forced_guardian_insert BEFORE INSERT ON guardian_grant FOR EACH ROW EXECUTE FUNCTION reject_guardian_insert()')
    try {
      await expect(grantGuardian(doctor, childId, { name: 'Familia fallida', email, proof: 'Identidad presencial' })).rejects.toThrow()
      expect(mails).toHaveLength(sent)
      expect(await db.select().from(user).where(eq(user.email, email))).toHaveLength(0)
    } finally {
      await pool.query('DROP TRIGGER forced_guardian_insert ON guardian_grant')
      await pool.query('DROP FUNCTION reject_guardian_insert()')
    }
  })

  it('keeps a previously delivered link valid if replacement SMTP rejects and records failure', async () => {
    const { grantGuardian } = await import('../../server/services/invitations')
    const { setupCredential, tokenDigest } = await import('../../server/services/invitation')
    const childId = randomUUID()
    const email = `${randomUUID()}@example.test`
    await db.insert(patient).values({ id: childId, name: 'Reenvío fallido', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
    await grantGuardian(doctor, childId, { name: 'Familia reenvío', email, proof: 'Identidad presencial' })
    const original = latestToken()
    const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
    failDelivery = true
    try {
      await grantGuardian(doctor, childId, { name: 'Familia reenvío', email, proof: 'Identidad presencial', confirmedGuardianId: owner!.id })
    } finally {
      failDelivery = false
    }
    const [link] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, childId))
    const [oldToken] = await db.select().from(setupToken).where(eq(setupToken.digest, tokenDigest(original)))
    expect(link).toMatchObject({ status: 'PENDING', tokenId: oldToken!.id, lastSendError: 'Error' })
    expect(oldToken?.usedAt).toBeNull()
    const [attempt] = await db.select().from(guardianDelivery).where(and(eq(guardianDelivery.patientId, childId), eq(guardianDelivery.state, 'FAILED')))
    expect(attempt?.payload).toBeNull()
    expect(await setupCredential(original, `retry-${randomUUID().slice(0, 8)}`, 'unique guardian passphrase')).toBe(true)
  })

  it('sends a committed queued invitation after a forced post-commit dispatch failure', async () => {
    const { grantGuardian, processQueuedGuardianDeliveries } = await import('../../server/services/invitations')
    const childId = randomUUID()
    const email = `${randomUUID()}@example.test`
    await db.insert(patient).values({ id: childId, name: 'Pendiente de reintento', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
    const sent = mails.length
    await pool.query(`CREATE FUNCTION reject_guardian_claim() RETURNS trigger AS $$ BEGIN IF NEW.patient_id = '${childId}' AND NEW.state = 'SENDING' THEN RAISE EXCEPTION 'forced claim failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`)
    await pool.query('CREATE TRIGGER forced_guardian_claim BEFORE UPDATE ON guardian_delivery FOR EACH ROW EXECUTE FUNCTION reject_guardian_claim()')
    try {
      await expect(grantGuardian(doctor, childId, { name: 'Familia pendiente', email, proof: 'Identidad presencial' })).rejects.toThrow()
      expect(mails).toHaveLength(sent)
      const [saved] = await db.select().from(guardianDelivery).where(eq(guardianDelivery.patientId, childId))
      expect(saved?.state).toBe('QUEUED')
      expect(saved?.payload).toBeTruthy()
    } finally {
      await pool.query('DROP TRIGGER forced_guardian_claim ON guardian_delivery')
      await pool.query('DROP FUNCTION reject_guardian_claim()')
    }
    expect(await processQueuedGuardianDeliveries()).toBe(1)
    expect(mails).toHaveLength(sent + 1)
    const [link] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, childId))
    expect(link?.status).toBe('PENDING')
    const { setupCredential } = await import('../../server/services/invitation')
    const token = latestToken()
    expect(await setupCredential(token, `recover-${randomUUID().slice(0, 8)}`, 'unique guardian passphrase')).toBe(true)
  })

  it('activates a delivered queued sibling after the guardian sets up the account from another child', async () => {
    const { grantGuardian, processQueuedGuardianDeliveries, getShareableChild } = await import('../../server/services/invitations')
    const { setupCredential } = await import('../../server/services/invitation')
    const email = `${randomUUID()}@example.test`
    const children = [randomUUID(), randomUUID()]
    await db.insert(patient).values(children.map(id => ({ id, name: 'Hijo en cola', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })))
    await grantGuardian(doctor, children[0]!, { name: 'Familia en cola', email, proof: 'Identidad presencial' })
    const firstToken = latestToken()
    const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
    await pool.query(`CREATE FUNCTION reject_queued_sibling() RETURNS trigger AS $$ BEGIN IF NEW.patient_id = '${children[1]}' AND NEW.state = 'SENDING' THEN RAISE EXCEPTION 'forced claim failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`)
    await pool.query('CREATE TRIGGER forced_sibling_claim BEFORE UPDATE ON guardian_delivery FOR EACH ROW EXECUTE FUNCTION reject_queued_sibling()')
    try {
      await expect(grantGuardian(doctor, children[1]!, { name: 'Familia en cola', email, proof: 'Identidad presencial', confirmedGuardianId: owner!.id })).rejects.toThrow()
    } finally {
      await pool.query('DROP TRIGGER forced_sibling_claim ON guardian_delivery')
      await pool.query('DROP FUNCTION reject_queued_sibling()')
    }
    expect(await setupCredential(firstToken, `queued-${randomUUID().slice(0, 8)}`, 'unique guardian passphrase')).toBe(true)
    expect(await processQueuedGuardianDeliveries()).toBe(1)
    const [siblingJob] = await db.select().from(guardianDelivery).where(eq(guardianDelivery.patientId, children[1]!))
    expect(siblingJob?.state).toBe('DONE')
    const [siblingLink] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, children[1]!))
    expect(siblingLink?.status).toBe('ACTIVE')
    expect((await getShareableChild({ id: owner!.id, roles: ['PATIENT'] }, children[1]!)).id).toBe(children[1])
  })

  it('never dispatches a queued link after the staff revokes its relationship', async () => {
    const { grantGuardian, processQueuedGuardianDeliveries, revokeGuardian } = await import('../../server/services/invitations')
    const childId = randomUUID()
    const email = `${randomUUID()}@example.test`
    await db.insert(patient).values({ id: childId, name: 'Vínculo revocado', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
    await pool.query(`CREATE FUNCTION reject_guardian_claim() RETURNS trigger AS $$ BEGIN IF NEW.patient_id = '${childId}' AND NEW.state = 'SENDING' THEN RAISE EXCEPTION 'forced claim failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`)
    await pool.query('CREATE TRIGGER forced_guardian_claim BEFORE UPDATE ON guardian_delivery FOR EACH ROW EXECUTE FUNCTION reject_guardian_claim()')
    try {
      await expect(grantGuardian(doctor, childId, { name: 'Familia revocada', email, proof: 'Identidad presencial' })).rejects.toThrow()
    } finally {
      await pool.query('DROP TRIGGER forced_guardian_claim ON guardian_delivery')
      await pool.query('DROP FUNCTION reject_guardian_claim()')
    }
    const [link] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, childId))
    await revokeGuardian(doctor, childId, link!.guardianId)
    const sent = mails.length
    await processQueuedGuardianDeliveries()
    expect(mails).toHaveLength(sent)
  })

  it('recovers an interrupted delivery with its committed token and no orphaned link', async () => {
    const { grantGuardian, processQueuedGuardianDeliveries, reconcileGuardianDeliveries } = await import('../../server/services/invitations')
    const childId = randomUUID()
    const email = `${randomUUID()}@example.test`
    await db.insert(patient).values({ id: childId, name: 'Entrega interrumpida', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
    const sent = mails.length
    await pool.query(`CREATE FUNCTION reject_guardian_finish() RETURNS trigger AS $$ BEGIN IF NEW.patient_id = '${childId}' AND NEW.state = 'DONE' THEN RAISE EXCEPTION 'forced finish failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`)
    await pool.query('CREATE TRIGGER forced_guardian_finish BEFORE UPDATE ON guardian_delivery FOR EACH ROW EXECUTE FUNCTION reject_guardian_finish()')
    try {
      await expect(grantGuardian(doctor, childId, { name: 'Familiar en espera', email, proof: 'Identidad presencial' })).rejects.toThrow()
      expect(mails).toHaveLength(sent + 1)
      const [saved] = await db.select().from(guardianDelivery).where(eq(guardianDelivery.patientId, childId))
      expect(saved).toMatchObject({ state: 'SENDING' })
      expect(saved?.payload).toBeTruthy()
    } finally {
      await pool.query('DROP TRIGGER forced_guardian_finish ON guardian_delivery')
      await pool.query('DROP FUNCTION reject_guardian_finish()')
    }
    expect(await reconcileGuardianDeliveries()).toBe(1)
    expect(await processQueuedGuardianDeliveries()).toBe(1)
    const [link] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, childId))
    expect(link?.status).toBe('PENDING')
    const [stored] = await db.select().from(setupToken).where(eq(setupToken.id, link!.tokenId!))
    expect(stored?.usedAt).toBeNull()
    expect(mails.at(-1)).toContain('invitacion/')
  })

  it('matches a phone-only representative by normalized number only after explicit attestation, without creating email duplicates', async () => {
    const { grantGuardian, findGuardianIdentity, getShareableChild } = await import('../../server/services/invitations')
    const one = randomUUID()
    const two = randomUUID()
    await db.insert(patient).values([one, two].map(id => ({ id, name: 'Hermano por teléfono', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })))
    const phone = `09${randomUUID().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`
    const firstResult = await grantGuardian(assistant, one, { name: 'Padre teléfono', phone, relationship: 'Padre', proof: 'Identidad presencial verificada' })
    expect(firstResult.status).toBe('FAILED')
    expect(await db.select().from(guardianDelivery).where(eq(guardianDelivery.patientId, one))).toHaveLength(0)
    const [phoneLink] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, one))
    expect(phoneLink).toMatchObject({ contactPhone: phone, relationship: 'Padre', status: 'FAILED', proof: 'Identidad presencial verificada' })
    expect(await db.select().from(user).where(eq(user.id, phoneLink!.guardianId))).toHaveLength(1)
    const match = await findGuardianIdentity(assistant, { phone: `+593${phone.slice(1)}` })
    expect(match).toMatchObject({ name: 'Padre teléfono' })
    expect(JSON.stringify(match)).not.toContain(phone)
    expect(match?.maskedContact).toBe(`${phone.slice(0, 2)}***${phone.slice(-2)}`)
    await expect(findGuardianIdentity(assistant, { phone: '123' })).rejects.toThrow()
    await expect(findGuardianIdentity(adminActor, { phone })).rejects.toThrow()
    await expect(grantGuardian(assistant, two, { name: 'Padre teléfono', phone, relationship: 'Padre', proof: 'Identidad presencial verificada' })).rejects.toThrow()
    const linked = await grantGuardian(doctor, two, { name: 'Padre teléfono', phone: `+593${phone.slice(1)}`, relationship: 'Padre', proof: 'Identidad presencial verificada', confirmedGuardianId: match!.id })
    expect(linked.status).toBe('FAILED')
    expect((await db.select().from(guardianGrant).where(eq(guardianGrant.guardianId, match!.id)))).toHaveLength(2)
    await expect(getShareableChild({ id: match!.id, roles: ['PATIENT'] }, one)).rejects.toThrow()
    const email = `${randomUUID()}@example.test`
    await grantGuardian(doctor, one, { name: 'Padre teléfono', phone, email, relationship: 'Padre', proof: 'Correo verificado presencialmente', confirmedGuardianId: match!.id })
    expect(await db.select().from(user).where(eq(user.email, email))).toHaveLength(1)
    await expect(grantGuardian(doctor, two, { name: 'Otro padre', phone, email: `${randomUUID()}@example.test`, relationship: 'Padre', proof: 'Identidad presencial', confirmedGuardianId: match!.id })).rejects.toThrow()
    const stranger = randomUUID()
    await db.insert(user).values({ id: stranger, name: 'Otro contacto', email: `${randomUUID()}@example.test` })
    await db.insert(guardianPhone).values({ guardianId: stranger, phone: '0999999999' })
    await expect(grantGuardian(doctor, two, { name: 'Contacto cruzado', phone: '0999999999', email, relationship: 'Padre', proof: 'Identidad presencial', confirmedGuardianId: match!.id })).rejects.toThrow()
  })

  it('grants an existing guardian without resetting credentials or granting any other child', async () => {
    const { grantGuardian, getShareableChild } = await import('../../server/services/invitations')
    const third = randomUUID()
    await db.insert(patient).values({ id: third, name: 'Niño C', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
    const [owner] = await db.select().from(user).where(eq(user.email, 'mother-a@example.test'))
    const [credential] = await db.select().from(account).where(eq(account.userId, owner!.id))
    await grantGuardian(doctor, third, { name: 'Madre A', email: 'mother-a@example.test', proof: 'Documento verificado', confirmedGuardianId: owner!.id })
    const [unchanged] = await db.select().from(account).where(eq(account.userId, owner!.id))
    expect(unchanged?.password).toBe(credential?.password)
    expect((await getShareableChild({ id: owner!.id, roles: ['PATIENT'] }, third)).id).toBe(third)
    await expect(getShareableChild({ id: otherId, roles: ['PATIENT'] }, third)).rejects.toThrow()
  })
})
