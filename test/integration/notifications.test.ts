import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { eq, sql } from 'drizzle-orm'
import type { Actor } from '../../shared/types/access'
import { appointment, bookingRequest, clinicSchedule, guardianGrant, inAppNotice, notificationAttempt, notificationOutbox, notificationPreference, openingHour, patient, user, visit, visitSharing } from '../../server/db/schema'
import { deliver, listInAppNotices, processNotificationOutbox, queueNotification, reconcileNotificationOutbox } from '../../server/services/outbox'
import { recordBookingAppointmentChange, submitParentBooking } from '../../server/services/booking'

const configured = process.env.DATABASE_URL
if (!configured || !new URL(configured).pathname.includes('pediatrico')) throw new Error('Dedicated pediatric test server required')
const name = `pediatrico_notices_${randomUUID().replaceAll('-', '')}`
const admin = new URL(configured)
admin.pathname = '/postgres'
const target = new URL(configured)
target.pathname = `/${name}`
const adminPool = new Pool({ connectionString: admin.href })
const pool = new Pool({ connectionString: target.href })
const db = drizzle(pool)
const prior = process.env.DATABASE_URL
const guardian: Actor = { id: randomUUID(), roles: ['PATIENT'] }
const doctor: Actor = { id: randomUUID(), roles: ['DOCTOR'] }
const child = randomUUID()
const request = randomUUID()
const now = new Date('2027-03-01T15:00:00Z')
let created = false

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${name}"`)
  created = true
  process.env.DATABASE_URL = target.href
  await migrate(db, { migrationsFolder: './server/db/migrations' })
  await db.insert(user).values({ id: guardian.id, name: 'Familia', email: 'family@example.test' })
  await db.insert(patient).values({ id: child, name: 'Paciente', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
  await db.insert(guardianGrant).values({ patientId: child, guardianId: guardian.id, contactEmail: 'family@example.test', proof: 'verified in person', verifiedBy: doctor.id, status: 'ACTIVE' })
  await db.insert(clinicSchedule).values({ id: 'clinic', durationMinutes: 30 })
  await db.insert(openingHour).values({ weekday: 1, open: '09:00', close: '10:00' })
}, 120000)

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE notification_attempt, in_app_notice, notification_outbox, notification_preference, booking_request, clinical_visit RESTART IDENTITY CASCADE`)
  await db.update(guardianGrant).set({ status: 'ACTIVE' }).where(eq(guardianGrant.patientId, child))
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

async function booking() {
  await db.insert(bookingRequest).values({ id: request, source: 'PARENT', patientId: child, guardianId: guardian.id, childName: 'Paciente', guardianName: 'Familia', email: 'family@example.test', startsAt: new Date('2027-03-02T14:00:00Z'), consentVersion: 'DRAFT-2026-11' })
  return db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: request }, { channel: 'IN_APP', userId: guardian.id }))
}

async function external() {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  await db.insert(bookingRequest).values({ id: request, source: 'PARENT', patientId: child, guardianId: guardian.id, childName: 'Paciente', guardianName: 'Familia', email: 'family@example.test', startsAt: new Date('2027-03-02T14:00:00Z'), consentVersion: 'DRAFT-2026-11' })
  return db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: request }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
}

async function row(id: string) {
  return (await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]!
}

it('commits intent atomically, deduplicates a replay, and does not require Valkey to drain', async () => {
  await db.insert(bookingRequest).values({ id: request, source: 'PARENT', patientId: child, guardianId: guardian.id, childName: 'Paciente', guardianName: 'Familia', email: 'family@example.test', startsAt: new Date('2027-03-02T14:00:00Z'), consentVersion: 'DRAFT-2026-11' })
  await expect(db.transaction(async (tx) => {
    await queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: request }, { channel: 'IN_APP', userId: guardian.id })
    throw new Error('rollback')
  })).rejects.toThrow('rollback')
  expect(await db.select().from(notificationOutbox)).toHaveLength(0)
  const first = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: request }, { channel: 'IN_APP', userId: guardian.id }))
  const second = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: request }, { channel: 'IN_APP', userId: guardian.id }))
  expect(second).toBe(first)
  expect(await processNotificationOutbox()).toBe(1)
  expect(await processNotificationOutbox()).toBe(0)
  expect(await db.select().from(inAppNotice)).toHaveLength(1)
})

it('commits a real parent booking and its in-app intent in one transaction', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  const intents = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
  expect(intents).toMatchObject([{ eventKind: 'BOOKING_PENDING', channel: 'IN_APP', recipientUserId: guardian.id }])
  expect((await db.select().from(bookingRequest).where(eq(bookingRequest.id, booked.id)))).toHaveLength(1)
})

it('does not expose a notice to another guardian or after revocation', async () => {
  await booking()
  await processNotificationOutbox()
  expect(await listInAppNotices(guardian)).toHaveLength(1)
  expect(await listInAppNotices({ id: randomUUID(), roles: ['PATIENT'] })).toEqual([])
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  expect(await listInAppNotices(guardian)).toEqual([])
})

it('suppresses a previously delivered visit notice when sharing is revoked', async () => {
  const id = randomUUID()
  await db.insert(visit).values({ id, patientId: child, measuredAt: new Date('2025-01-01T12:00:00Z'), weightKg: '9', lengthHeightCm: '75', position: 'RECUMBENT', headCircumferenceCm: '45', createdBy: doctor.id, requestId: randomUUID(), requestDigest: randomUUID(), bmi: '16', correctionUntilMonths: 24, authorId: doctor.id, shareWithFamily: true })
  await db.transaction(tx => queueNotification(tx, { kind: 'VISIT_RECORDED', subjectId: id }, { channel: 'IN_APP', userId: guardian.id }))
  await processNotificationOutbox()
  expect(await listInAppNotices(guardian)).toHaveLength(1)
  await db.insert(visitSharing).values({ visitId: id, shared: false, changedBy: doctor.id })
  expect(await listInAppNotices(guardian)).toEqual([])
})

it('records unconfigured email without claiming a send', async () => {
  const id = await external()
  expect(await deliver(id, now)).toMatchObject({ status: 'NOT_CONFIGURED' })
  expect((await row(id)).deliveredAt).toBeNull()
  expect(await db.select().from(notificationAttempt)).toMatchObject([{ outcome: 'NOT_CONFIGURED' }])
})

it('delivers only to the verified public booking email when a provider is explicitly available', async () => {
  await db.insert(bookingRequest).values({ id: request, source: 'PUBLIC', childName: 'Paciente', guardianName: 'Familia', email: 'verified@example.test', startsAt: new Date('2027-03-02T14:00:00Z'), consentVersion: 'DRAFT-2026-11' })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: request }, { channel: 'EMAIL', address: 'verified@example.test' }))
  const destinations: string[] = []
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async ({ address }: { address: string }) => {
    destinations.push(address)
    return 'SENT' as const
  } }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'SENT' })
  expect(destinations).toEqual(['verified@example.test'])
  expect((await row(id)).address).toBeNull()
  expect(await listInAppNotices(guardian)).toEqual([])
})

it('holds a claim until lease expiry and never marks an active send interrupted', async () => {
  const id = await external()
  let release!: () => void
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => {
    entered()
    await wait
    return 'SENT' as const
  } }
  const sending = deliver(id, now, adapter)
  await started
  try {
    expect((await row(id)).state).toBe('SENDING')
    expect(await deliver(id, now, adapter)).toMatchObject({ status: 'DEFERRED' })
    expect(await reconcileNotificationOutbox(now)).toBe(0)
  } finally {
    release()
  }
  expect(await sending).toMatchObject({ status: 'SENT' })
  expect(await db.select().from(notificationAttempt)).toHaveLength(1)
})

it('reconciles an expired lease while a provider is stalled without claiming success', async () => {
  const id = await external()
  let started!: () => void
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  let release!: (value: 'SENT') => void
  const waiting = new Promise<'SENT'>((resolve) => {
    release = resolve
  })
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => {
    started()
    return waiting
  } }
  const sending = deliver(id, now, adapter)
  await entered
  try {
    expect(await processNotificationOutbox(new Date(now.getTime() + 5 * 60000 + 1))).toBe(0)
    expect((await row(id)).state).toBe('FAILED')
  } finally {
    release('SENT')
    await sending
  }
})

it('bounds a stalled external send without replaying an uncertain result', async () => {
  const id = await external()
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => new Promise<'SENT'>(() => {}) }
  expect(await deliver(id, now, adapter, 20)).toMatchObject({ status: 'FAILED' })
  expect((await row(id)).errorClass).toBe('DeliveryUncertain')
  expect(await deliver(id, new Date(now.getTime() + 10 * 60000), adapter, 20)).toMatchObject({ status: 'FAILED' })
  expect(await db.select().from(notificationAttempt)).toHaveLength(1)
})

it('reconciles an expired lease without replaying an uncertain external send', async () => {
  const id = await external()
  await db.update(notificationOutbox).set({ state: 'SENDING', attempts: 1, nextAttemptAt: new Date(now.getTime() - 1) }).where(eq(notificationOutbox.id, id))
  expect(await reconcileNotificationOutbox(now)).toBe(1)
  expect((await row(id)).state).toBe('FAILED')
  expect(await deliver(id, now)).toMatchObject({ status: 'FAILED' })
})

it('retries an explicit no-send failure with bounded backoff then dead-letters', async () => {
  const id = await external()
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'RETRY' as const }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'RETRY' })
  expect((await row(id)).nextAttemptAt).toEqual(new Date(now.getTime() + 60000))
  expect(await deliver(id, new Date(now.getTime() + 30000), adapter)).toMatchObject({ status: 'DEFERRED' })
  expect(await deliver(id, new Date(now.getTime() + 60000), adapter)).toMatchObject({ status: 'RETRY' })
  expect((await row(id)).nextAttemptAt).toEqual(new Date(now.getTime() + 180000))
  expect(await deliver(id, new Date(now.getTime() + 180000), adapter)).toMatchObject({ status: 'FAILED' })
  expect((await row(id)).attempts).toBe(3)
  expect(await db.select().from(notificationAttempt)).toHaveLength(3)
})

it('rejects a missing booking and a public booking addressed to a different verified email', async () => {
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'other@example.test' }))).rejects.toThrow()
  await db.insert(bookingRequest).values({ id: request, source: 'PUBLIC', childName: 'Paciente', guardianName: 'Familia', email: 'verified@example.test', startsAt: new Date('2027-03-02T14:00:00Z'), consentVersion: 'DRAFT-2026-11' })
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: request }, { channel: 'EMAIL', address: 'other@example.test' }))).rejects.toThrow()
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: request }, { channel: 'IN_APP', userId: guardian.id }))).rejects.toThrow()
  expect(await db.select().from(notificationOutbox)).toHaveLength(0)
})

it('rejects a forged in-app booking row before delivery', async () => {
  await booking()
  const stranger = randomUUID()
  await db.insert(user).values({ id: stranger, name: 'Otro', email: 'other@example.test' })
  const forged = randomUUID()
  await db.insert(notificationOutbox).values({ id: forged, eventKind: 'BOOKING_APPROVED', subjectId: request, channel: 'IN_APP', recipientKey: stranger, recipientUserId: stranger })
  expect(await deliver(forged)).toMatchObject({ status: 'OPTED_OUT' })
  expect(await db.select().from(inAppNotice)).toHaveLength(0)
})

it('treats a return to the original appointment time as a new occurrence', async () => {
  await booking()
  const appointmentId = randomUUID()
  await db.insert(appointment).values({ id: appointmentId, patientId: child, name: 'Paciente', contact: 'family@example.test', reason: '', startsAt: new Date('2027-03-02T14:00:00Z'), endsAt: new Date('2027-03-02T14:30:00Z'), status: 'CONFIRMED', createdBy: doctor.id })
  await db.update(bookingRequest).set({ status: 'APPROVED', appointmentId }).where(eq(bookingRequest.id, request))
  for (const time of ['2027-03-02T14:30:00Z', '2027-03-02T14:00:00Z', '2027-03-02T14:30:00Z']) {
    const start = new Date(time)
    await db.transaction(async (tx) => {
      await tx.update(appointment).set({ startsAt: start, endsAt: new Date(start.getTime() + 1800000) }).where(eq(appointment.id, appointmentId))
      await recordBookingAppointmentChange(tx, appointmentId, 'RESCHEDULED')
    })
  }
  expect(await db.select().from(notificationOutbox).where(eq(notificationOutbox.eventKind, 'BOOKING_RESCHEDULED'))).toHaveLength(3)
})

it('does not accept a forged booking owner or a private visit recipient', async () => {
  await booking()
  const stranger = randomUUID()
  await db.insert(user).values({ id: stranger, name: 'Otro', email: `${stranger}@example.test` })
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: request }, { channel: 'IN_APP', userId: stranger }))).rejects.toThrow()
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'VISIT_RECORDED', subjectId: randomUUID() }, { channel: 'IN_APP', userId: guardian.id }))).rejects.toThrow()
  expect(await db.select().from(notificationOutbox)).toHaveLength(1)
})
