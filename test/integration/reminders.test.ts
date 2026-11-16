import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { eq, sql } from 'drizzle-orm'
import type { Actor } from '../../shared/types/access'
import { completedCheckup, guardianGrant, guardianPhone, individualCheckup, notificationOutbox, notificationPreference, patient, user } from '../../server/db/schema'
import { deliver, listInAppNotices, markInAppNoticeRead, processNotificationOutbox, queueNotification } from '../../server/services/outbox'
import { scanCheckupReminders } from '../../server/services/reminders'
import { getNoticePreferences, noticePreferencesSchema, setEmailNoticePreference, setWhatsAppNoticePreference } from '../../server/services/notice-preferences'

const configured = process.env.DATABASE_URL
if (!configured || !new URL(configured).pathname.includes('pediatrico')) throw new Error('Dedicated pediatric test server required')
const name = `pediatrico_reminders_${randomUUID().replaceAll('-', '')}`
const admin = new URL(configured)
admin.pathname = '/postgres'
const target = new URL(configured)
target.pathname = `/${name}`
const adminPool = new Pool({ connectionString: admin.href })
const pool = new Pool({ connectionString: target.href })
const db = drizzle(pool)
const prior = process.env.DATABASE_URL
const doctor: Actor = { id: randomUUID(), roles: ['DOCTOR'] }
const guardian: Actor = { id: randomUUID(), roles: ['PATIENT'] }
const other: Actor = { id: randomUUID(), roles: ['PATIENT'] }
const child = randomUUID()
const checkupId = randomUUID()
const due = new Date('2027-03-01T15:00:00Z')
let created = false

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${name}"`)
  created = true
  process.env.DATABASE_URL = target.href
  await migrate(db, { migrationsFolder: './server/db/migrations' })
  await db.insert(user).values([{ id: guardian.id, name: 'Familia', email: 'family@example.test' }, { id: other.id, name: 'Otra familia', email: 'other@example.test' }])
  await db.insert(patient).values({ id: child, name: 'Paciente', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
  await db.insert(guardianGrant).values({ patientId: child, guardianId: guardian.id, contactEmail: 'family@example.test', proof: 'verified', verifiedBy: doctor.id, status: 'ACTIVE' })
}, 120000)

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE completed_checkup, individual_checkup, notification_attempt, in_app_notice, notification_outbox, notification_preference, guardian_phone RESTART IDENTITY CASCADE`)
  await db.update(guardianGrant).set({ status: 'ACTIVE' }).where(eq(guardianGrant.patientId, child))
  await db.insert(individualCheckup).values({ id: checkupId, patientId: child, date: '2027-03-01', reason: 'Revisión indicada', authorId: doctor.id })
})

afterAll(async () => {
  process.env.DATABASE_URL = prior
  await pool.end()
  const { useDb } = await import('../../server/utils/db')
  await useDb().$client.end()
  try {
    if (created) await adminPool.query(`DROP DATABASE "${name}"`)
  } finally {
    await adminPool.end()
  }
})

it('defaults to email off and permits only the guardian to set their own explicit consent', async () => {
  expect(await getNoticePreferences(guardian)).toEqual({ inApp: true, email: false, whatsapp: false })
  await expect(setEmailNoticePreference(doctor, true)).rejects.toThrow()
  expect(await setEmailNoticePreference(guardian, true)).toEqual({ inApp: true, email: true, whatsapp: false })
  expect(await getNoticePreferences(other)).toEqual({ inApp: true, email: false, whatsapp: false })
  expect(await setEmailNoticePreference(guardian, false)).toEqual({ inApp: true, email: false, whatsapp: false })
})

it('accepts explicit WhatsApp preference updates without implicitly switching email or in-app', () => {
  expect(noticePreferencesSchema.parse({ whatsapp: true })).toEqual({ whatsapp: true })
  expect(noticePreferencesSchema.parse({ email: false, whatsapp: true })).toEqual({ email: false, whatsapp: true })
  expect(noticePreferencesSchema.safeParse({ inApp: false }).success).toBe(false)
  expect(noticePreferencesSchema.safeParse({ whatsapp: 'true' }).success).toBe(false)
  expect(noticePreferencesSchema.safeParse({}).success).toBe(false)
})

it('defaults WhatsApp off, isolates consent by guardian and keeps in-app available', async () => {
  expect(await getNoticePreferences(guardian)).toEqual({ inApp: true, email: false, whatsapp: false })
  await expect(setWhatsAppNoticePreference(doctor, true)).rejects.toThrow()
  expect(await setWhatsAppNoticePreference(guardian, true)).toEqual({ inApp: true, email: false, whatsapp: true })
  expect(await getNoticePreferences(other)).toEqual({ inApp: true, email: false, whatsapp: false })
  expect(await setWhatsAppNoticePreference(guardian, false)).toEqual({ inApp: true, email: false, whatsapp: false })
})

it('queues WhatsApp only for opted-in verified guardian with matching active grant phone', async () => {
  await setWhatsAppNoticePreference(guardian, true)
  expect(await scanCheckupReminders(due)).toBe(1)
  await db.insert(guardianPhone).values({ guardianId: guardian.id, phone: '+593991234567' })
  expect(await scanCheckupReminders(due)).toBe(0)
  await db.update(guardianGrant).set({ contactPhone: '+593991234567' }).where(eq(guardianGrant.patientId, child))
  expect(await scanCheckupReminders(due)).toBe(1)
  expect(await scanCheckupReminders(due)).toBe(0)
  expect(await db.select().from(notificationOutbox).where(eq(notificationOutbox.channel, 'WHATSAPP'))).toMatchObject([
    { eventKind: 'CHECKUP_DUE', subjectId: checkupId, channel: 'WHATSAPP', recipientUserId: guardian.id, address: null }
  ])
})

it('requeues opted-out WhatsApp only after renewed consent while verified and due, never after accepted delivery', async () => {
  await db.insert(guardianPhone).values({ guardianId: guardian.id, phone: '+593991234567' })
  await db.update(guardianGrant).set({ contactPhone: '+593991234567' }).where(eq(guardianGrant.patientId, child))
  await setWhatsAppNoticePreference(guardian, true)
  expect(await scanCheckupReminders(due)).toBe(2)
  const [whatsapp] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.channel, 'WHATSAPP'))
  await setWhatsAppNoticePreference(guardian, false)
  const sent: string[] = []
  const adapter = { channel: 'WHATSAPP' as const, status: () => 'READY' as const, send: async ({ address }: { address: string }) => {
    sent.push(address)
    return 'ACCEPTED' as const
  } }
  expect(await deliver(whatsapp!.id, due, adapter)).toMatchObject({ status: 'OPTED_OUT' })
  await setWhatsAppNoticePreference(guardian, true)
  await db.update(guardianPhone).set({ phone: '+593998888888' }).where(eq(guardianPhone.guardianId, guardian.id))
  expect(await scanCheckupReminders(due)).toBe(0)
  await db.update(guardianPhone).set({ phone: '+593991234567' }).where(eq(guardianPhone.guardianId, guardian.id))
  expect(await scanCheckupReminders(due)).toBe(1)
  expect(await deliver(whatsapp!.id, due, adapter)).toMatchObject({ status: 'ACCEPTED' })
  expect(sent).toEqual(['+593991234567'])
  expect(await scanCheckupReminders(due)).toBe(0)
})

it('does not queue WhatsApp for completed controls or revoked guardian grants', async () => {
  await db.insert(guardianPhone).values({ guardianId: guardian.id, phone: '+593991234567' })
  await db.update(guardianGrant).set({ contactPhone: '+593991234567', status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  await setWhatsAppNoticePreference(guardian, true)
  expect(await scanCheckupReminders(due)).toBe(0)
  await db.update(guardianGrant).set({ status: 'ACTIVE' }).where(eq(guardianGrant.patientId, child))
  await db.insert(completedCheckup).values({ id: randomUUID(), patientId: child, individualId: checkupId, completedAt: '2027-03-01', authorId: doctor.id })
  expect(await scanCheckupReminders(due)).toBe(0)
  expect(await db.select().from(notificationOutbox)).toEqual([])
})

it('queues a new WhatsApp intent for a newly verified grant number without reusing the former address', async () => {
  await db.insert(guardianPhone).values({ guardianId: guardian.id, phone: '+593991234567' })
  await db.update(guardianGrant).set({ contactPhone: '+593991234567' }).where(eq(guardianGrant.patientId, child))
  await setWhatsAppNoticePreference(guardian, true)
  expect(await scanCheckupReminders(due)).toBe(2)
  await db.update(guardianPhone).set({ phone: '+593998888888' }).where(eq(guardianPhone.guardianId, guardian.id))
  await db.update(guardianGrant).set({ contactPhone: '+593998888888' }).where(eq(guardianGrant.patientId, child))
  expect(await scanCheckupReminders(due)).toBe(1)
  const rows = await db.select().from(notificationOutbox).where(eq(notificationOutbox.channel, 'WHATSAPP'))
  expect(rows).toHaveLength(2)
  expect(rows[0]?.recipientKey).not.toBe(rows[1]?.recipientKey)
  const sent: string[] = []
  const adapter = { channel: 'WHATSAPP' as const, status: () => 'READY' as const, send: async ({ address }: { address: string }) => {
    sent.push(address)
    return 'ACCEPTED' as const
  } }
  expect(await deliver(rows[0]!.id, due, adapter)).toMatchObject({ status: 'OPTED_OUT' })
  expect(await deliver(rows[1]!.id, due, adapter)).toMatchObject({ status: 'ACCEPTED' })
  expect(sent).toEqual(['+593998888888'])
})

it('queues a due individual reminder once for an active guardian, in app without email consent', async () => {
  expect(await scanCheckupReminders(new Date('2027-02-28T15:00:00Z'))).toBe(0)
  expect(await scanCheckupReminders(due)).toBe(1)
  expect(await scanCheckupReminders(due)).toBe(0)
  expect(await db.select().from(notificationOutbox)).toMatchObject([{ eventKind: 'CHECKUP_DUE', subjectId: checkupId, channel: 'IN_APP', recipientUserId: guardian.id }])
  await processNotificationOutbox(due)
  expect(await listInAppNotices(guardian)).toMatchObject([{ eventKind: 'CHECKUP_DUE', subjectId: checkupId, dueDate: '2027-03-01' }])
  expect(await listInAppNotices(other)).toEqual([])
})

it('deduplicates simultaneous scans for the same guardian and checkup', async () => {
  const counts = await Promise.all([scanCheckupReminders(due), scanCheckupReminders(due)])
  expect(counts.reduce((total, count) => total + count, 0)).toBe(1)
  expect(await db.select().from(notificationOutbox)).toHaveLength(1)
})

it('delivers in-app reminders even if a legacy in-app preference is disabled', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'IN_APP', enabled: false })
  await scanCheckupReminders(due)
  await processNotificationOutbox(due)
  expect(await listInAppNotices(guardian)).toHaveLength(1)
})

it('queues email only with explicit opt-in and never leaks the address into the outbox', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  expect(await scanCheckupReminders(due)).toBe(2)
  expect(await db.select().from(notificationOutbox)).toMatchObject([
    { channel: 'IN_APP', address: null },
    { channel: 'EMAIL', address: null }
  ])
})

it('rejects a forged recipient and suppresses completed or revoked reminders at queue and delivery', async () => {
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'CHECKUP_DUE', subjectId: checkupId }, { channel: 'IN_APP', userId: other.id }))).rejects.toThrow()
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'CHECKUP_DUE', subjectId: checkupId }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))).rejects.toThrow()
  expect(await scanCheckupReminders(due)).toBe(1)
  const [row] = await db.select().from(notificationOutbox)
  await db.insert(completedCheckup).values({ id: randomUUID(), patientId: child, individualId: checkupId, completedAt: '2027-03-01', authorId: doctor.id })
  expect(await deliver(row!.id, due)).toMatchObject({ status: 'OPTED_OUT' })
  expect(await listInAppNotices(guardian)).toEqual([])
  await db.delete(completedCheckup).where(eq(completedCheckup.individualId, checkupId))
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  expect(await scanCheckupReminders(due)).toBe(0)
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'CHECKUP_DUE', subjectId: checkupId }, { channel: 'IN_APP', userId: guardian.id }))).rejects.toThrow()
})

it('does not send email after opt-out or completion, and does not queue source-derived draft checkups', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  await scanCheckupReminders(due)
  const [email] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.channel, 'EMAIL'))
  await db.update(notificationPreference).set({ enabled: false }).where(eq(notificationPreference.userId, guardian.id))
  const sent: string[] = []
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async ({ address }: { address: string }) => {
    sent.push(address)
    return 'SENT' as const
  } }
  expect(await deliver(email!.id, due, adapter)).toMatchObject({ status: 'OPTED_OUT' })
  expect(sent).toEqual([])
  await db.update(notificationPreference).set({ enabled: true }).where(eq(notificationPreference.userId, guardian.id))
  await db.update(notificationOutbox).set({ state: 'QUEUED' }).where(eq(notificationOutbox.id, email!.id))
  await db.insert(completedCheckup).values({ id: randomUUID(), patientId: child, individualId: checkupId, completedAt: '2027-03-01', authorId: doctor.id })
  expect(await deliver(email!.id, due, adapter)).toMatchObject({ status: 'OPTED_OUT' })
  expect(await scanCheckupReminders(due)).toBe(0)
  expect(sent).toEqual([])
})

it('requeues a suppressed due email after renewed consent only while eligible, never after send or uncertainty', async () => {
  await setEmailNoticePreference(guardian, true)
  expect(await scanCheckupReminders(due)).toBe(2)
  const [email] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.channel, 'EMAIL'))
  await setEmailNoticePreference(guardian, false)
  const sent: string[] = []
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async ({ address }: { address: string }) => {
    sent.push(address)
    return 'SENT' as const
  } }
  expect(await deliver(email!.id, due, adapter)).toMatchObject({ status: 'OPTED_OUT' })
  expect(await scanCheckupReminders(due)).toBe(0)
  await setEmailNoticePreference(guardian, true)
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  expect(await scanCheckupReminders(due)).toBe(0)
  await db.update(guardianGrant).set({ status: 'ACTIVE' }).where(eq(guardianGrant.patientId, child))
  await db.insert(completedCheckup).values({ id: randomUUID(), patientId: child, individualId: checkupId, completedAt: '2027-03-01', authorId: doctor.id })
  expect(await scanCheckupReminders(due)).toBe(0)
  await db.delete(completedCheckup).where(eq(completedCheckup.individualId, checkupId))
  expect(await scanCheckupReminders(due)).toBe(1)
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, email!.id)))[0]).toMatchObject({ state: 'QUEUED' })
  expect(await deliver(email!.id, due, adapter)).toMatchObject({ status: 'SENT' })
  expect(sent).toEqual(['family@example.test'])
  expect(await scanCheckupReminders(due)).toBe(0)
  await db.update(notificationOutbox).set({ state: 'FAILED', errorClass: 'DeliveryUncertain' }).where(eq(notificationOutbox.id, email!.id))
  expect(await scanCheckupReminders(due)).toBe(0)
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, email!.id)))[0]).toMatchObject({ state: 'FAILED', errorClass: 'DeliveryUncertain' })
})

it('suppresses due email revoked at the claim before invoking the external adapter', async () => {
  await setEmailNoticePreference(guardian, true)
  await scanCheckupReminders(due)
  const [email] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.channel, 'EMAIL'))
  await db.execute(sql`CREATE FUNCTION revoke_on_due_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state = 'SENDING' THEN UPDATE guardian_grant SET status = 'REVOKED' WHERE status = 'ACTIVE'; END IF; RETURN NEW; END $$`)
  await db.execute(sql`CREATE TRIGGER revoke_on_due_claim AFTER UPDATE ON notification_outbox FOR EACH ROW EXECUTE FUNCTION revoke_on_due_claim()`)
  const sent: string[] = []
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async ({ address }: { address: string }) => {
    sent.push(address)
    return 'SENT' as const
  } }
  try {
    expect(await deliver(email!.id, due, adapter)).toMatchObject({ status: 'OPTED_OUT' })
    expect(sent).toEqual([])
    expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, email!.id)))[0]).toMatchObject({ state: 'OPTED_OUT' })
  } finally {
    await db.execute(sql`DROP TRIGGER revoke_on_due_claim ON notification_outbox`)
    await db.execute(sql`DROP FUNCTION revoke_on_due_claim()`)
  }
})

it('does not replay an in-flight due email after grant revocation even if the provider accepts it', async () => {
  await setEmailNoticePreference(guardian, true)
  await scanCheckupReminders(due)
  const [email] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.channel, 'EMAIL'))
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const sent: string[] = []
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async ({ address }: { address: string }) => {
    entered()
    await waiting
    sent.push(address)
    return 'SENT' as const
  } }
  const sending = deliver(email!.id, due, adapter)
  await started
  try {
    expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, email!.id)))[0]).toMatchObject({ state: 'SENDING' })
    await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  } finally { release() }
  expect(await sending).toMatchObject({ status: 'SENT' })
  expect(sent).toEqual(['family@example.test'])
  expect(await deliver(email!.id, due, adapter)).toMatchObject({ status: 'SENT' })
  expect(await scanCheckupReminders(due)).toBe(0)
  expect(sent).toHaveLength(1)
})

it('hides a queued reminder if it is completed before delivery and stays hidden after a later scan', async () => {
  await scanCheckupReminders(due)
  await db.insert(completedCheckup).values({ id: randomUUID(), patientId: child, individualId: checkupId, completedAt: '2027-03-01', authorId: doctor.id })
  await processNotificationOutbox(due)
  expect(await listInAppNotices(guardian)).toEqual([])
  expect(await scanCheckupReminders(due)).toBe(0)
})

it('marks only an accessible guardian notice read, rejecting another guardian or a completed checkup', async () => {
  await scanCheckupReminders(due)
  await processNotificationOutbox(due)
  const [notice] = await listInAppNotices(guardian)
  await expect(markInAppNoticeRead(other, notice!.id)).rejects.toThrow()
  await markInAppNoticeRead(guardian, notice!.id)
  expect((await listInAppNotices(guardian))[0]?.readAt).not.toBeNull()
  await db.insert(completedCheckup).values({ id: randomUUID(), patientId: child, individualId: checkupId, completedAt: '2027-03-01', authorId: doctor.id })
  await expect(markInAppNoticeRead(guardian, notice!.id)).rejects.toThrow()
})

it('hides an already delivered reminder when the checkup is completed or the grant is revoked', async () => {
  await scanCheckupReminders(due)
  await processNotificationOutbox(due)
  expect(await listInAppNotices(guardian)).toHaveLength(1)
  await db.insert(completedCheckup).values({ id: randomUUID(), patientId: child, individualId: checkupId, completedAt: '2027-03-01', authorId: doctor.id })
  expect(await listInAppNotices(guardian)).toEqual([])
  await db.delete(completedCheckup).where(eq(completedCheckup.individualId, checkupId))
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  expect(await listInAppNotices(guardian)).toEqual([])
})
