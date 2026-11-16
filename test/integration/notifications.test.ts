import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { eq, sql } from 'drizzle-orm'
import { notificationAttempt, notificationOutbox, notificationPreference, inAppNotice, patient, user, guardianGrant, bookingRequest, clinicSchedule, openingHour, visitSharing, appointment } from '../../server/db/schema'
import { queueNotification, deliver, processNotificationOutbox, reconcileNotificationOutbox, listInAppNotices, providerStatus } from '../../server/services/outbox'
import { createVisit } from '../../server/services/visits'
import { decideBookingRequest, recordBookingAppointmentChange, submitParentBooking } from '../../server/services/booking'
import type { Actor } from '../../shared/types/access'

const source = process.env.DATABASE_URL
if (!source || !new URL(source).pathname.includes('pediatrico')) throw new Error('Dedicated pediatric test server required')
const name = `pediatrico_notices_${randomUUID().replaceAll('-', '')}`
const admin = new URL(source)
admin.pathname = '/postgres'
const target = new URL(source)
target.pathname = `/${name}`
const adminPool = new Pool({ connectionString: admin.href })
const pool = new Pool({ connectionString: target.href })
const db = drizzle(pool)
const prior = process.env.DATABASE_URL
const guardian: Actor = { id: randomUUID(), roles: ['PATIENT'] }
const doctor: Actor = { id: randomUUID(), roles: ['DOCTOR'] }
const child = randomUUID()
let created = false

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${name}"`)
  created = true
  process.env.DATABASE_URL = target.href
  await migrate(db, { migrationsFolder: './server/db/migrations' })
  await db.insert(user).values({ id: guardian.id, name: 'Familia', email: 'family@example.test' })
  await db.insert(patient).values({ id: child, name: 'Paciente privado', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
  await db.insert(guardianGrant).values({ patientId: child, guardianId: guardian.id, contactEmail: 'family@example.test', proof: 'verified in person', verifiedBy: doctor.id, status: 'ACTIVE' })
  await db.insert(clinicSchedule).values({ id: 'clinic', durationMinutes: 30 })
  await db.insert(openingHour).values({ weekday: 1, open: '09:00', close: '10:00' })
}, 120000)
beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE notification_attempt, in_app_notice, notification_outbox, notification_preference, booking_request, appointment, clinical_visit RESTART IDENTITY CASCADE`)
  await db.update(user).set({ email: 'family@example.test' }).where(eq(user.id, guardian.id))
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

it('rejects a wrong recipient channel or blank address at runtime', async () => {
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'SMS' as 'EMAIL', address: 'x' }))).rejects.toThrow()
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: '  ' }))).rejects.toThrow()
  expect(await db.select().from(notificationOutbox)).toHaveLength(0)
})

it('rejects unsupported events before writing an intent', async () => {
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'PRIVATE_DIAGNOSIS' as 'VISIT_RECORDED', subjectId: randomUUID() }, { channel: 'IN_APP', userId: guardian.id }))).rejects.toThrow()
  expect(await db.select().from(notificationOutbox)).toHaveLength(0)
})

it('rejects a booking notice addressed to a different guardian', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  const stranger = randomUUID()
  await db.insert(user).values({ id: stranger, name: 'Desconocido', email: `${stranger}@example.test` })
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: booked.id }, { channel: 'IN_APP', userId: stranger }))).rejects.toThrow()
})

it('rejects a mismatched authenticated external contact rather than silently queuing it', async () => {
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'other@example.test' }))).rejects.toThrow()
  expect(await db.select().from(notificationOutbox)).toHaveLength(0)
})

it('rejects malformed external contact instead of persisting it', async () => {
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'not-an-email' }))).rejects.toThrow()
  expect(await db.select().from(notificationOutbox)).toHaveLength(0)
})

it('does not queue a booking intent for a different account with a matching address', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  const stranger = randomUUID()
  await db.insert(user).values({ id: stranger, name: 'Desconocido', email: `${stranger}@example.test` })
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: booked.id }, { channel: 'EMAIL', userId: stranger, address: `${stranger}@example.test` }))).rejects.toThrow()
})

it('deduplicates identical intent across separate transactions', async () => {
  const event = { kind: 'BOOKING_PENDING' as const, subjectId: randomUUID() }
  const recipient = { channel: 'EMAIL' as const, address: 'public@example.test' }
  const first = await db.transaction(tx => queueNotification(tx, event, recipient))
  const second = await db.transaction(tx => queueNotification(tx, event, recipient))
  expect(second).toBe(first)
  expect(await db.select().from(notificationOutbox)).toHaveLength(1)
})

it('uses occurrence identity for distinct booking changes but keeps repeats idempotent', async () => {
  const subjectId = randomUUID()
  const recipient = { channel: 'EMAIL' as const, address: 'public@example.test' }
  const a = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_RESCHEDULED', subjectId, occurrenceId: '2027-03-01T14:00:00.000Z' }, recipient))
  const b = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_RESCHEDULED', subjectId, occurrenceId: '2027-03-01T14:30:00.000Z' }, recipient))
  const replay = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_RESCHEDULED', subjectId, occurrenceId: '2027-03-01T14:30:00.000Z' }, recipient))
  expect(a).not.toBe(b)
  expect(replay).toBe(b)
})

it('rejects a repeated occurrence identifier for an unrelated booking event', async () => {
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID(), occurrenceId: 'arbitrary' }, { channel: 'EMAIL', address: 'public@example.test' }))).rejects.toThrow()
})

it('rejects a visit notice before the visit exists', async () => {
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'VISIT_RECORDED', subjectId: randomUUID() }, { channel: 'IN_APP', userId: guardian.id }))).rejects.toThrow()
})

it('rolls back notification intent with its domain transaction and deduplicates event/recipient/channel', async () => {
  const event = { kind: 'BOOKING_PENDING' as const, subjectId: randomUUID() }
  const recipient = { channel: 'IN_APP' as const, userId: guardian.id }
  await expect(db.transaction(async (tx) => {
    await queueNotification(tx, event, recipient)
    throw new Error('rollback')
  })).rejects.toThrow('rollback')
  expect(await db.select().from(notificationOutbox)).toHaveLength(0)
  const ids = await db.transaction(async tx => [await queueNotification(tx, event, recipient), await queueNotification(tx, event, recipient)])
  expect(ids[0]).toBe(ids[1])
  expect(await db.select().from(notificationOutbox)).toHaveLength(1)
})

it('rejects unsupported WhatsApp contact formatting before storage', async () => {
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'WHATSAPP', address: 'not-a-number' }))).rejects.toThrow()
})

it('does not claim WhatsApp is configured without a provider', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'WHATSAPP', address: '+593991234567' }))
  expect(await deliver(id)).toMatchObject({ status: 'NOT_CONFIGURED' })
  expect((await db.select().from(notificationAttempt))[0]?.outcome).toBe('NOT_CONFIGURED')
})

it('rejects a future external adapter without a verified recipient mapping', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'OPTED_OUT' })
  expect(await db.select().from(notificationAttempt)).toHaveLength(0)
})

it('does not expose raw recipient contact in a provider failure record', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'private-recipient@example.test' }))
  expect(await deliver(id)).toMatchObject({ status: 'NOT_CONFIGURED' })
  expect(JSON.stringify({ outbox: await db.select().from(notificationOutbox), attempts: await db.select().from(notificationAttempt) })).not.toContain('private-recipient@example.test')
})

it('never treats public booking contact proof as an authenticated notification recipient', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.recipientUserId).toBeNull()
  expect(await deliver(id)).toMatchObject({ status: 'NOT_CONFIGURED' })
  expect(await listInAppNotices(guardian)).toHaveLength(0)
})

it('rejects external booking for a public request with a claimed account recipient', async () => {
  const id = randomUUID()
  await db.insert(bookingRequest).values({ id, source: 'PUBLIC', childName: 'Niña externa', guardianName: 'Representante', email: 'family@example.test', startsAt: new Date('2027-03-01T14:00:00Z'), consentVersion: 'DRAFT-2026-11' })
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: id }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))).rejects.toThrow()
})

it('queues public booking with hashed contact only and no portal recipient', async () => {
  const id = randomUUID()
  await db.insert(bookingRequest).values({ id, source: 'PUBLIC', childName: 'Niña externa', guardianName: 'Representante', email: 'external@example.test', startsAt: new Date('2027-03-01T14:00:00Z'), consentVersion: 'DRAFT-2026-11' })
  const queued = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: id }, { channel: 'EMAIL', address: 'external@example.test' }))
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, queued))
  expect(row).toMatchObject({ recipientUserId: null, address: null, channel: 'EMAIL' })
  expect(await listInAppNotices(guardian)).toHaveLength(0)
})

it('deduplicates a replayed reschedule at the same appointment time', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  const appointmentId = randomUUID()
  await db.insert(appointment).values({ id: appointmentId, patientId: child, name: 'Paciente privado', contact: 'family@example.test', reason: '', startsAt: new Date('2027-03-01T14:00:00Z'), endsAt: new Date('2027-03-01T14:30:00Z'), status: 'CONFIRMED', createdBy: doctor.id })
  await db.update(bookingRequest).set({ status: 'APPROVED', appointmentId }).where(eq(bookingRequest.id, booked.id))
  await db.transaction(tx => recordBookingAppointmentChange(tx, appointmentId, 'RESCHEDULED'))
  await db.transaction(tx => recordBookingAppointmentChange(tx, appointmentId, 'RESCHEDULED'))
  expect(await db.select().from(notificationOutbox).where(eq(notificationOutbox.eventKind, 'BOOKING_RESCHEDULED'))).toHaveLength(1)
})

it('does not use a patient name, reason, or appointment contact in a booking change intent', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  const appointmentId = randomUUID()
  await db.insert(appointment).values({ id: appointmentId, patientId: child, name: 'SECRET-PATIENT-NAME', contact: 'family@example.test', reason: 'SECRET-CLINICAL-REASON', startsAt: new Date('2027-03-01T14:00:00Z'), endsAt: new Date('2027-03-01T14:30:00Z'), status: 'CONFIRMED', createdBy: doctor.id })
  await db.update(bookingRequest).set({ status: 'APPROVED', appointmentId }).where(eq(bookingRequest.id, booked.id))
  await db.transaction(tx => recordBookingAppointmentChange(tx, appointmentId, 'CANCELLED'))
  const rows = await db.select().from(notificationOutbox)
  expect(JSON.stringify(rows)).not.toContain('SECRET-CLINICAL-REASON')
  expect(JSON.stringify(rows)).not.toContain('SECRET-PATIENT-NAME')
})

it('keeps distinct reschedule intents when an appointment changes more than once', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  const appointmentId = randomUUID()
  await db.insert(appointment).values({ id: appointmentId, patientId: child, name: 'Paciente privado', contact: 'family@example.test', reason: '', startsAt: new Date('2027-03-01T14:00:00Z'), endsAt: new Date('2027-03-01T14:30:00Z'), status: 'CONFIRMED', createdBy: doctor.id })
  await db.update(bookingRequest).set({ status: 'APPROVED', appointmentId }).where(eq(bookingRequest.id, booked.id))
  await db.transaction(tx => recordBookingAppointmentChange(tx, appointmentId, 'RESCHEDULED'))
  await db.update(appointment).set({ startsAt: new Date('2027-03-01T14:30:00Z'), endsAt: new Date('2027-03-01T15:00:00Z') }).where(eq(appointment.id, appointmentId))
  await db.transaction(tx => recordBookingAppointmentChange(tx, appointmentId, 'RESCHEDULED'))
  expect(await db.select().from(notificationOutbox).where(eq(notificationOutbox.eventKind, 'BOOKING_RESCHEDULED'))).toHaveLength(2)
})

it('shows a parent booking change notice using the request identity, not the appointment identity', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  const appointmentId = randomUUID()
  await db.insert(appointment).values({ id: appointmentId, patientId: child, name: 'Paciente privado', contact: 'family@example.test', reason: '', startsAt: new Date('2027-03-01T14:00:00Z'), endsAt: new Date('2027-03-01T14:30:00Z'), status: 'CONFIRMED', createdBy: doctor.id })
  await db.update(bookingRequest).set({ status: 'APPROVED', appointmentId }).where(eq(bookingRequest.id, booked.id))
  await db.transaction(tx => recordBookingAppointmentChange(tx, appointmentId, 'CANCELLED'))
  await processNotificationOutbox()
  expect((await listInAppNotices(guardian)).some(row => row.eventKind === 'BOOKING_CANCELLED' && row.subjectId === booked.id)).toBe(true)
})

it('persists parent booking and minimal notice intent together without granting new access', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  expect((await db.select().from(bookingRequest).where(eq(bookingRequest.id, booked.id)))).toHaveLength(1)
  expect(await db.select().from(notificationOutbox)).toMatchObject([{ eventKind: 'BOOKING_PENDING', subjectId: booked.id, recipientUserId: guardian.id, channel: 'IN_APP' }])
})

it('creates one minimal visit notice despite idempotent request replay, without clinical payload', async () => {
  const input = { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT' as const, headCircumferenceCm: 45, privateNote: 'SECRET-CLINICAL-NOTE' }
  const first = await createVisit(doctor, child, input)
  await createVisit(doctor, child, input)
  const rows = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, first.id))
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ eventKind: 'VISIT_RECORDED', channel: 'IN_APP', recipientUserId: guardian.id })
  expect(JSON.stringify(rows)).not.toContain('SECRET-CLINICAL-NOTE')
})

it('delivers in-app once, records attempt, restricts notices to owner and survives missing Valkey', async () => {
  const requestId = randomUUID()
  await db.insert(bookingRequest).values({ id: requestId, source: 'PARENT', patientId: child, guardianId: guardian.id, childName: 'Paciente privado', guardianName: 'Familia', email: 'family@example.test', startsAt: new Date('2027-03-01T14:00:00Z'), consentVersion: 'DRAFT-2026-11' })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: requestId }, { channel: 'IN_APP', userId: guardian.id }))
  expect(await processNotificationOutbox()).toBe(1)
  expect(await deliver(id)).toMatchObject({ status: 'SENT' })
  expect(await db.select().from(notificationAttempt)).toHaveLength(1)
  expect(await db.select().from(inAppNotice)).toHaveLength(1)
  expect(await listInAppNotices(guardian)).toHaveLength(1)
  expect(await listInAppNotices({ id: randomUUID(), roles: ['PATIENT'] })).toHaveLength(0)
})

it('recovers an interrupted claim without sending again or claiming success', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'family@example.test' }))
  await db.update(notificationOutbox).set({ state: 'SENDING', attempts: 1 }).where(eq(notificationOutbox.id, id))
  expect(await reconcileNotificationOutbox()).toBe(1)
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.state).toBe('FAILED')
  expect(await processNotificationOutbox()).toBe(0)
  expect(await db.select().from(notificationAttempt)).toMatchObject([{ outcome: 'FAILED', errorClass: 'InterruptedDelivery' }])
})

it('drains durable pending intents after Valkey is unavailable and never repeats them', async () => {
  const priorRedis = process.env.REDIS_URL
  process.env.REDIS_URL = 'redis://127.0.0.1:1'
  try {
    const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
    expect(booked.status).toBe('PENDING')
    expect(await processNotificationOutbox()).toBe(1)
    expect(await processNotificationOutbox()).toBe(0)
    expect(await db.select().from(inAppNotice)).toHaveLength(1)
  } finally {
    process.env.REDIS_URL = priorRedis
  }
})

it('stores only a digest of external recipient contact, not a raw address or identity key', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id))
  expect(row?.address).toBeNull()
  expect(row?.recipientKey).toBe(createHash('sha256').update('email:public@example.test').digest('hex'))
})

it('reports unconfigured external transport before opt-in and never records sent', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  expect(await deliver(id)).toMatchObject({ status: 'NOT_CONFIGURED' })
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.state).toBe('NOT_CONFIGURED')
  expect(await db.select().from(inAppNotice)).toHaveLength(0)
})

it('does not confuse a ready adapter for a different channel with configured delivery', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  let called = false
  const adapter = { channel: 'WHATSAPP' as const, status: () => 'READY' as const, send: async () => {
    called = true
    return 'SENT' as const
  } }
  expect(await deliver(id, new Date(Date.now() + 86400000), adapter)).toMatchObject({ status: 'NOT_CONFIGURED' })
  expect(called).toBe(false)
})

it('does not allow an email provider to take over a WhatsApp intent', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'WHATSAPP', address: '+593991234567' }))
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  expect(await deliver(id, new Date(Date.now() + 86400000), adapter)).toMatchObject({ status: 'NOT_CONFIGURED' })
})

it('never reports unavailable transports as sent; retains failure and attempt history', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'family@example.test', userId: guardian.id }))
  expect(providerStatus('EMAIL')).toBe('NOT_CONFIGURED')
  expect(providerStatus('WHATSAPP')).toBe('NOT_CONFIGURED')
  expect(providerStatus('IN_APP')).toBe('READY')
  expect(await deliver(id)).toMatchObject({ status: 'NOT_CONFIGURED' })
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.state).toBe('NOT_CONFIGURED')
  expect(await db.select().from(notificationAttempt)).toMatchObject([{ outcome: 'NOT_CONFIGURED' }])
  expect(await db.select().from(inAppNotice)).toHaveLength(0)
})

it('hides parent booking notices when the guardian grant is revoked', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === booked.id)).toBe(true)
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === booked.id)).toBe(false)
  await db.update(guardianGrant).set({ status: 'ACTIVE' }).where(eq(guardianGrant.patientId, child))
})

it('does not queue a private visit for guardians', async () => {
  const input = { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT' as const, headCircumferenceCm: 45, shareWithFamily: false }
  const snapshot = await createVisit(doctor, child, input)
  expect(await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id))).toHaveLength(0)
})

it('hides a visit notice when the clinician revokes its sharing override', async () => {
  const input = { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT' as const, headCircumferenceCm: 45 }
  const snapshot = await createVisit(doctor, child, input)
  await processNotificationOutbox()
  expect(await listInAppNotices(guardian)).toHaveLength(1)
  await db.insert(visitSharing).values({ visitId: snapshot.id, shared: false, changedBy: doctor.id })
  expect(await listInAppNotices(guardian)).toHaveLength(0)
})

it('does not expose an in-app notice for a different guardian even if the row was inserted directly', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  const stranger = randomUUID()
  await db.insert(user).values({ id: stranger, name: 'Desconocido', email: `${stranger}@example.test` })
  await db.insert(notificationOutbox).values({ id: randomUUID(), eventKind: 'BOOKING_PENDING', subjectId: booked.id, channel: 'IN_APP', recipientKey: stranger, recipientUserId: stranger })
  const [malicious] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.recipientUserId, stranger))
  await db.insert(inAppNotice).values({ id: randomUUID(), outboxId: malicious!.id, userId: stranger, eventKind: 'BOOKING_PENDING', subjectId: booked.id })
  expect(await listInAppNotices({ id: stranger, roles: ['PATIENT'] })).toHaveLength(0)
})

it('does not expose an in-app visit notice to an unrelated patient account', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  const stranger = randomUUID()
  await db.insert(user).values({ id: stranger, name: 'Desconocido', email: `${stranger}@example.test` })
  const outboxId = randomUUID()
  await db.insert(notificationOutbox).values({ id: outboxId, eventKind: 'VISIT_RECORDED', subjectId: snapshot.id, channel: 'IN_APP', recipientKey: stranger, recipientUserId: stranger })
  await db.insert(inAppNotice).values({ id: randomUUID(), outboxId, userId: stranger, eventKind: 'VISIT_RECORDED', subjectId: snapshot.id })
  expect(await listInAppNotices({ id: stranger, roles: ['PATIENT'] })).toHaveLength(0)
})

it('does not expose a visit notice for a clinician-only sharing override', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45, shareWithFamily: false })
  await db.insert(visitSharing).values({ visitId: snapshot.id, shared: true, changedBy: doctor.id })
  expect(await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id))).toHaveLength(0)
})

it('keeps a visit notice private when shared is disabled after delivery', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await processNotificationOutbox()
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === snapshot.id)).toBe(true)
  await db.insert(visitSharing).values({ visitId: snapshot.id, shared: false, changedBy: doctor.id })
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === snapshot.id)).toBe(false)
})

it('does not expose an in-app notice to an admin and patient mixed role', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  expect((await listInAppNotices({ id: guardian.id, roles: ['ADMIN', 'PATIENT'] })).some(row => row.subjectId === booked.id)).toBe(false)
})

it('does not create a portal grant when an in-app notice is queued', async () => {
  const initial = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, child))
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === booked.id)).toBe(true)
  expect(await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, child))).toEqual(initial)
})

it('keeps a declined public request without in-app access or recipient user', async () => {
  const id = randomUUID()
  await db.insert(bookingRequest).values({ id, source: 'PUBLIC', childName: 'Niña externa', guardianName: 'Representante', email: 'public@example.test', startsAt: new Date('2027-03-01T14:00:00Z'), consentVersion: 'DRAFT-2026-11', status: 'DECLINED' })
  await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_DECLINED', subjectId: id }, { channel: 'EMAIL', address: 'public@example.test' }))
  expect((await db.select().from(notificationOutbox))[0]?.recipientUserId).toBeNull()
  expect(await listInAppNotices(guardian)).toHaveLength(0)
})

it('does not expose a visit notice created before guardian access was revoked', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await processNotificationOutbox()
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === snapshot.id)).toBe(false)
})

it('does not expose a visit notice after guardian access is revoked', async () => {
  const input = { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT' as const, headCircumferenceCm: 45 }
  await createVisit(doctor, child, input)
  await processNotificationOutbox()
  expect(await listInAppNotices(guardian)).toHaveLength(1)
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  expect(await listInAppNotices(guardian)).toHaveLength(0)
})

it('does not send to a changed account address that no longer matches the original opt-in identity', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  await db.update(user).set({ email: 'changed@example.test' }).where(eq(user.id, guardian.id))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'FAILED' })
  expect((await db.select().from(notificationAttempt))[0]?.errorClass).toBe('RecipientUnavailable')
  await db.update(user).set({ email: 'family@example.test' }).where(eq(user.id, guardian.id))
})

it('hides visit notices for an admin-only user even if a row was addressed to them', async () => {
  const adminActor: Actor = { id: guardian.id, roles: ['ADMIN'] }
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await processNotificationOutbox()
  expect((await listInAppNotices(adminActor)).some(row => row.subjectId === snapshot.id)).toBe(false)
})

it('does not expose private visit metadata if the guardian grant is revoked after in-app delivery', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await processNotificationOutbox()
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === snapshot.id)).toBe(true)
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === snapshot.id)).toBe(false)
})

it('does not deliver a queued visit after a guardian grant is revoked', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'VISIT_RECORDED', subjectId: snapshot.id }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'OPTED_OUT' })
})

it('leaves a claimed send uncertain after restart instead of replaying it', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  let release!: () => void
  let started!: () => void
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => {
    started()
    await waiting
    return 'SENT' as const
  } }
  const delivery = deliver(id, now, adapter)
  await entered
  try {
    expect(await reconcileNotificationOutbox()).toBe(1)
    expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.state).toBe('FAILED')
  } finally {
    release()
  }
  expect(await delivery).toMatchObject({ status: 'FAILED' })
  expect((await db.select().from(notificationAttempt)).map(row => row.outcome)).toEqual(['FAILED'])
})

it('does not leak the account address through a public in-app notice', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  const notices = await listInAppNotices(guardian)
  expect(notices.some(row => row.subjectId === booked.id)).toBe(true)
  expect(JSON.stringify(notices)).not.toContain('family@example.test')
})

it('does not expose notices to scheduling assistants', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  expect((await listInAppNotices({ id: guardian.id, roles: ['ASSISTANT'] })).some(row => row.subjectId === booked.id)).toBe(false)
})

it('does not expose a guardian notice to a doctor role acting as the same user', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  expect((await listInAppNotices({ id: guardian.id, roles: ['DOCTOR'] })).some(row => row.subjectId === booked.id)).toBe(false)
})

it('does not expose booking notice when the guardian grant is absent at read time', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === booked.id)).toBe(true)
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === booked.id)).toBe(false)
})

it('does not expose a public booking notice to a matching-email account', async () => {
  const id = randomUUID()
  await db.insert(bookingRequest).values({ id, source: 'PUBLIC', childName: 'Niña externa', guardianName: 'Representante', email: 'family@example.test', startsAt: new Date('2027-03-01T14:00:00Z'), consentVersion: 'DRAFT-2026-11' })
  await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: id }, { channel: 'EMAIL', address: 'family@example.test' }))
  await processNotificationOutbox()
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === id)).toBe(false)
})

it('does not hold the database row lock while the provider is waiting', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  let release!: () => void
  let started!: () => void
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => {
    started()
    await waiting
    return 'SENT' as const
  } }
  const delivery = deliver(id, now, adapter)
  await entered
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('outbox row locked during provider send')), 1000))
  try {
    const [row] = await Promise.race([db.update(notificationOutbox).set({ errorClass: 'probe' }).where(eq(notificationOutbox.id, id)).returning(), timeout])
    expect(row?.state).toBe('SENDING')
  } finally {
    release()
  }
  expect(await delivery).toMatchObject({ status: 'SENT' })
})

it('refuses a visit notice to a stranger even when in-app was requested', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  const stranger = randomUUID()
  await db.insert(user).values({ id: stranger, name: 'Desconocido', email: `${stranger}@example.test` })
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'VISIT_RECORDED', subjectId: snapshot.id }, { channel: 'IN_APP', userId: stranger }))).rejects.toThrow()
})

it('refuses an external visit recipient without an active guardian grant', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  const stranger = randomUUID()
  await db.insert(user).values({ id: stranger, name: 'Desconocido', email: `${stranger}@example.test` })
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'VISIT_RECORDED', subjectId: snapshot.id }, { channel: 'EMAIL', userId: stranger, address: `${stranger}@example.test` }))).rejects.toThrow()
  expect(await db.select().from(notificationOutbox).where(eq(notificationOutbox.recipientUserId, stranger))).toHaveLength(0)
})

it('rejects a mismatched booking owner when external intent is queued', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  const stranger = randomUUID()
  await db.insert(user).values({ id: stranger, name: 'Desconocido', email: `${stranger}@example.test` })
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: booked.id }, { channel: 'EMAIL', userId: stranger, address: `${stranger}@example.test` }))).rejects.toThrow()
})

it('does not send external visit metadata after sharing is revoked', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'VISIT_RECORDED', subjectId: snapshot.id }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  await db.insert(visitSharing).values({ visitId: snapshot.id, shared: false, changedBy: doctor.id })
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  let sent = false
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => {
    sent = true
    return 'SENT' as const
  } }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'OPTED_OUT' })
  expect(sent).toBe(false)
})

it('does not send an unshared visit that was private before delivery', async () => {
  const input = { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT' as const, headCircumferenceCm: 45 }
  await db.update(guardianGrant).set({ status: 'ACTIVE' }).where(eq(guardianGrant.patientId, child))
  const snapshot = await createVisit(doctor, child, input)
  await db.insert(visitSharing).values({ visitId: snapshot.id, shared: false, changedBy: doctor.id })
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id))
  expect(await deliver(row!.id)).toMatchObject({ status: 'OPTED_OUT' })
  expect(await db.select().from(inAppNotice)).toHaveLength(0)
})

it('does not persist a secret clinical note in any visit notification row or attempt', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45, privateNote: 'PRIVATE-DIAGNOSIS-NEVER-SEND' })
  await processNotificationOutbox()
  const rows = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id))
  const attempts = await db.select().from(notificationAttempt)
  expect(JSON.stringify({ rows, attempts, notices: await db.select().from(inAppNotice) })).not.toContain('PRIVATE-DIAGNOSIS-NEVER-SEND')
})

it('rejects WhatsApp account identity without a verified phone mapping', async () => {
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'WHATSAPP', address: '+593991234567', userId: guardian.id }))).rejects.toThrow()
})

it('does not convert contact verification into a guardian grant', async () => {
  const id = randomUUID()
  await db.insert(bookingRequest).values({ id, source: 'PUBLIC', childName: 'Niña externa', guardianName: 'Representante', email: 'family@example.test', startsAt: new Date('2027-03-01T14:00:00Z'), consentVersion: 'DRAFT-2026-11' })
  await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: id }, { channel: 'EMAIL', address: 'family@example.test' }))
  const [row] = await db.select().from(bookingRequest).where(eq(bookingRequest.id, id))
  expect(row).toMatchObject({ guardianId: null, patientId: null })
})

it('does not reveal visit identity through a request without an active grant', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'VISIT_RECORDED', subjectId: snapshot.id }, { channel: 'IN_APP', userId: guardian.id }))).rejects.toThrow()
})

it('does not enqueue a visit notice if the visit is not shared', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45, shareWithFamily: false })
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'VISIT_RECORDED', subjectId: snapshot.id }, { channel: 'IN_APP', userId: guardian.id }))).rejects.toThrow()
})

it('does not queue a visit notification when the request replays an existing visit', async () => {
  const input = { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT' as const, headCircumferenceCm: 45 }
  const snapshot = await createVisit(doctor, child, input)
  await createVisit(doctor, child, input)
  expect(await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id))).toHaveLength(1)
})

it('does not queue a second visit intent when the same request ID has a conflicting payload', async () => {
  const input = { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT' as const, headCircumferenceCm: 45 }
  const snapshot = await createVisit(doctor, child, input)
  await expect(createVisit(doctor, child, { ...input, weightKg: 10 })).rejects.toThrow()
  expect(await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id))).toHaveLength(1)
})

it('does not queue a visit notice when an invalid measurement rolls back', async () => {
  await expect(createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 0, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })).rejects.toThrow()
  expect(await db.select().from(notificationOutbox)).toHaveLength(0)
})

it('does not persist a new notification for a replayed booking decision', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await db.update(bookingRequest).set({ status: 'DECLINED' }).where(eq(bookingRequest.id, booked.id))
  const count = (await db.select().from(notificationOutbox)).length
  await expect(decideBookingRequest(doctor, booked.id, 'DECLINE')).rejects.toThrow()
  expect(await db.select().from(notificationOutbox)).toHaveLength(count)
})

it('does not leave an intent behind when a parent booking fails due to unavailable slot', async () => {
  await expect(submitParentBooking(guardian, { patientId: child, date: '2027-03-02', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })).rejects.toThrow()
  expect(await db.select().from(notificationOutbox)).toHaveLength(0)
})

it('does not enqueue a booking notice when a guardian grant is revoked', async () => {
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  await expect(submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })).rejects.toThrow()
  expect(await db.select().from(notificationOutbox)).toHaveLength(0)
})

it('keeps a non-shareable visit out of the outbox even when its author is a doctor', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45, shareWithFamily: false })
  expect(await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id))).toHaveLength(0)
})

it('still creates a visit record when no guardian has an active grant', async () => {
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  expect(snapshot.patientId).toBe(child)
  expect(await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id))).toHaveLength(0)
})

it('keeps a visit notice out of the queue when a guardian account was not verified', async () => {
  await db.update(guardianGrant).set({ status: 'PENDING' }).where(eq(guardianGrant.patientId, child))
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  expect(await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id))).toHaveLength(0)
})

it('does not create a guardian notification for an admin-only actor', async () => {
  const adminActor: Actor = { id: randomUUID(), roles: ['ADMIN'] }
  await expect(createVisit(adminActor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })).rejects.toThrow()
  expect(await db.select().from(notificationOutbox)).toHaveLength(0)
})

it('does not create a booking notice if the guardian account lacks a patient role', async () => {
  await expect(submitParentBooking({ id: guardian.id, roles: ['ASSISTANT'] }, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })).rejects.toThrow()
  expect(await db.select().from(notificationOutbox)).toHaveLength(0)
})

it('does not record a provider send when a retry interval is not yet due', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'RETRY' as const }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'RETRY' })
  expect(await deliver(id, new Date(now.getTime() + 30000), adapter)).toMatchObject({ status: 'DEFERRED' })
  expect(await db.select().from(notificationAttempt)).toHaveLength(1)
})

it('does not re-send in-app notifications if two worker ticks see the same intent', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
  const results = await Promise.all([deliver(row!.id), deliver(row!.id)])
  expect(results).toEqual([{ id: row!.id, status: 'SENT' }, { id: row!.id, status: 'SENT' }])
  expect(await db.select().from(inAppNotice)).toHaveLength(1)
  expect(await db.select().from(notificationAttempt)).toHaveLength(1)
})

it('does not create two in-app notices for repeated visit delivery calls', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id))
  expect(await deliver(row!.id)).toMatchObject({ status: 'SENT' })
  expect(await deliver(row!.id)).toMatchObject({ status: 'SENT' })
  expect(await db.select().from(inAppNotice)).toHaveLength(1)
})

it('does not duplicate an external failure attempt when a worker revisits a terminal outbox row', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  expect(await deliver(id)).toMatchObject({ status: 'NOT_CONFIGURED' })
  expect(await deliver(id)).toMatchObject({ status: 'NOT_CONFIGURED' })
  expect(await db.select().from(notificationAttempt)).toHaveLength(1)
})

it('does not leak provider error details when a send rejects', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => {
    throw new Error('secret from transport')
  } }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'FAILED' })
  expect((await db.select().from(notificationAttempt))[0]?.errorClass).toBe('DeliveryUncertain')
})

it('returns not found without changing any delivery record', async () => {
  expect(await deliver(randomUUID())).toMatchObject({ status: 'NOT_FOUND' })
  expect(await db.select().from(notificationAttempt)).toHaveLength(0)
})

it('does not leak notices for a deleted or missing recipient', async () => {
  expect(await listInAppNotices({ id: randomUUID(), roles: ['PATIENT'] })).toEqual([])
})

it('does not auto-run a provider on the PostgreSQL polling worker', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  expect(await processNotificationOutbox()).toBe(1)
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.state).toBe('NOT_CONFIGURED')
})

it('does not queue email for a clinical visit by default', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  const rows = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id))
  expect(rows.map(row => row.channel)).toEqual(['IN_APP'])
})

it('does not queue WhatsApp for a booking without explicit preferences', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  const rows = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
  expect(rows.map(row => row.channel)).toEqual(['IN_APP'])
})

it('does not store a raw booking guardian email in the notification rows', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  const rows = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
  expect(JSON.stringify(rows)).not.toContain('family@example.test')
})

it('does not store a clinical visit reason in the in-app notice', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45, privateNote: 'secret clinic note' })
  await processNotificationOutbox()
  const notices = await db.select().from(inAppNotice).where(eq(inAppNotice.subjectId, snapshot.id))
  expect(JSON.stringify(notices)).not.toContain('secret clinic note')
})

it('does not count an unconfigured provider as a successful delivery', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  expect(await deliver(id)).toMatchObject({ status: 'NOT_CONFIGURED' })
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id))
  expect(row?.deliveredAt).toBeNull()
  expect(row?.attempts).toBe(1)
})

it('does not allow a provider to change an already sent in-app intent', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
  expect(await deliver(row!.id)).toMatchObject({ status: 'SENT' })
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'FAILED' as const }
  expect(await deliver(row!.id, new Date(Date.now() + 86400000), adapter)).toMatchObject({ status: 'SENT' })
})

it('does not repeat a failed provider attempt on subsequent polling', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'FAILED' as const }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'FAILED' })
  expect(await processNotificationOutbox(new Date(now.getTime() + 60000))).toBe(0)
})

it('keeps attempts bounded on a permanent provider error', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'FAILED' as const }
  await deliver(id, now, adapter)
  await deliver(id, now, adapter)
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.attempts).toBe(1)
})

it('does not queue a second pending booking for the same parent after conflict', async () => {
  await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await expect(submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:30', consent: true, consentVersion: 'DRAFT-2026-11' })).rejects.toThrow()
  expect(await db.select().from(notificationOutbox)).toHaveLength(1)
})

it('keeps the same in-app notice when a completed delivery is polled again after restart', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  const before = await db.select().from(inAppNotice).where(eq(inAppNotice.subjectId, booked.id))
  await reconcileNotificationOutbox()
  await processNotificationOutbox()
  expect(await db.select().from(inAppNotice).where(eq(inAppNotice.subjectId, booked.id))).toEqual(before)
})

it('keeps the queue recoverable when Valkey configuration is invalid', async () => {
  const priorRedis = process.env.REDIS_URL
  process.env.REDIS_URL = 'redis://invalid.local:1'
  try {
    const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
    expect(await processNotificationOutbox()).toBe(1)
    expect((await listInAppNotices(guardian)).some(row => row.subjectId === booked.id)).toBe(true)
  } finally {
    process.env.REDIS_URL = priorRedis
  }
})

it('does not change outbox state when worker sees no pending work', async () => {
  expect(await processNotificationOutbox()).toBe(0)
  expect(await db.select().from(notificationAttempt)).toHaveLength(0)
})

it('does not let a notification cause a parent portal grant', async () => {
  const before = await db.select().from(guardianGrant)
  await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  await processNotificationOutbox()
  expect(await db.select().from(guardianGrant)).toEqual(before)
})

it('does not expose an unconfigured email address in provider status', async () => {
  expect(providerStatus('EMAIL')).toBe('NOT_CONFIGURED')
  expect(providerStatus('WHATSAPP')).toBe('NOT_CONFIGURED')
})

it('does not send an external channel just because an account email exists', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  expect(await deliver(id)).toMatchObject({ status: 'NOT_CONFIGURED' })
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.deliveredAt).toBeNull()
})

it('does not create an in-app notice for a public booking request', async () => {
  const id = randomUUID()
  await db.insert(bookingRequest).values({ id, source: 'PUBLIC', childName: 'Niña externa', guardianName: 'Representante', email: 'public@example.test', startsAt: new Date('2027-03-01T14:00:00Z'), consentVersion: 'DRAFT-2026-11' })
  await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: id }, { channel: 'EMAIL', address: 'public@example.test' }))
  await processNotificationOutbox()
  expect(await db.select().from(inAppNotice)).toHaveLength(0)
})

it('keeps a parent booking in-app even without an external provider', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  expect(providerStatus('EMAIL')).toBe('NOT_CONFIGURED')
  await processNotificationOutbox()
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === booked.id)).toBe(true)
})

it('records only the outbox id as an external idempotency key', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  let key = ''
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async (input: { idempotencyKey: string }) => {
    key = input.idempotencyKey
    return 'SENT' as const
  } }
  await deliver(id, now, adapter)
  expect(key).toBe(id)
})

it('does not deliver an unknown notification ID even when an adapter is ready', async () => {
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  expect(await deliver(randomUUID(), new Date(Date.now() + 86400000), adapter)).toMatchObject({ status: 'NOT_FOUND' })
})

it('keeps the in-app notification payload free of clinical measurements', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await processNotificationOutbox()
  const notices = await db.select().from(inAppNotice).where(eq(inAppNotice.subjectId, snapshot.id))
  expect(JSON.stringify(notices)).not.toContain('headCircumferenceCm')
  expect(JSON.stringify(notices)).not.toContain('weightKg')
})

it('does not expose an in-app notice to a stranger even with the subject UUID', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  const stranger: Actor = { id: randomUUID(), roles: ['PATIENT'] }
  expect((await listInAppNotices(stranger)).some(row => row.subjectId === booked.id)).toBe(false)
})

it('does not persist an external destination address for WhatsApp notices', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'WHATSAPP', address: '+593991234567' }))
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id))
  expect(row?.address).toBeNull()
  expect(JSON.stringify(row)).not.toContain('+593991234567')
})

it('does not deliver an opted-out in-app notice on a later worker tick', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'IN_APP', enabled: false })
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  expect(await processNotificationOutbox()).toBe(1)
  expect(await processNotificationOutbox()).toBe(0)
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id)))[0]?.state).toBe('OPTED_OUT')
})

it('does not requeue a terminal unconfigured message after Valkey recovers', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  expect(await processNotificationOutbox()).toBe(1)
  expect(await reconcileNotificationOutbox()).toBe(0)
  expect(await processNotificationOutbox()).toBe(0)
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.state).toBe('NOT_CONFIGURED')
})

it('does not change a sent in-app notice after Valkey downtime and recovery', async () => {
  const priorRedis = process.env.REDIS_URL
  process.env.REDIS_URL = 'redis://127.0.0.1:1'
  try {
    const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
    await processNotificationOutbox()
    const before = await db.select().from(inAppNotice).where(eq(inAppNotice.subjectId, booked.id))
    process.env.REDIS_URL = priorRedis
    await reconcileNotificationOutbox()
    await processNotificationOutbox()
    expect(await db.select().from(inAppNotice).where(eq(inAppNotice.subjectId, booked.id))).toEqual(before)
  } finally {
    process.env.REDIS_URL = priorRedis
  }
})

it('does not expose a provider failure to another guardian in their in-app list', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  expect(await deliver(id)).toMatchObject({ status: 'NOT_CONFIGURED' })
  expect(await listInAppNotices({ id: randomUUID(), roles: ['PATIENT'] })).toEqual([])
})

it('does not persist secrets when a provider adapter reports FAILED', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'FAILED' as const }
  await deliver(id, now, adapter)
  expect(JSON.stringify(await db.select().from(notificationAttempt))).not.toContain('family@example.test')
})

it('does not send clinical content in an in-app notification after a visit is recorded', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45, privateNote: 'secret summary' })
  await processNotificationOutbox()
  const [notice] = await db.select().from(inAppNotice).where(eq(inAppNotice.subjectId, snapshot.id))
  expect(notice).toMatchObject({ eventKind: 'VISIT_RECORDED', subjectId: snapshot.id, userId: guardian.id })
  expect(JSON.stringify(notice)).not.toContain('secret summary')
})

it('does not deliver a visit before its clinician-selected sharing flag is true', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45, shareWithFamily: false })
  expect(await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id))).toHaveLength(0)
})

it('records an in-app delivery attempt only once even when polling is repeated', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  await processNotificationOutbox()
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
  expect((await db.select().from(notificationAttempt).where(eq(notificationAttempt.outboxId, row!.id)))).toHaveLength(1)
})

it('does not mistake a no-op delivery for sent', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  expect(await deliver(id)).not.toMatchObject({ status: 'SENT' })
})

it('does not send after quiet hours if the user opted out while deferred', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const outside = new Date(Date.now() + 86400000)
  outside.setUTCHours(2, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  expect(await deliver(id, outside, adapter)).toMatchObject({ status: 'DEFERRED' })
  await db.update(notificationPreference).set({ enabled: false }).where(eq(notificationPreference.userId, guardian.id))
  expect(await deliver(id, new Date(outside.getTime() + 11 * 3600000), adapter)).toMatchObject({ status: 'OPTED_OUT' })
})

it('does not mark a deferred external intent as attempted', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const outside = new Date(Date.now() + 86400000)
  outside.setUTCHours(2, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  await deliver(id, outside, adapter)
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.attempts).toBe(0)
})

it('does not queue duplicate booking intents for identical recipient and event after retry', async () => {
  const event = { kind: 'BOOKING_PENDING' as const, subjectId: randomUUID() }
  const recipient = { channel: 'EMAIL' as const, address: 'public@example.test' }
  const id = await db.transaction(tx => queueNotification(tx, event, recipient))
  await deliver(id)
  expect(await db.transaction(tx => queueNotification(tx, event, recipient))).toBe(id)
  expect(await db.select().from(notificationOutbox)).toHaveLength(1)
})

it('does not turn an opted-out preference back on when a booking is submitted', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'IN_APP', enabled: false })
  await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  const [preference] = await db.select().from(notificationPreference).where(eq(notificationPreference.userId, guardian.id))
  expect(preference?.enabled).toBe(false)
})

it('does not send a booking notice to a public request with only contact verification', async () => {
  const id = randomUUID()
  await db.insert(bookingRequest).values({ id, source: 'PUBLIC', childName: 'Niña externa', guardianName: 'Representante', email: 'public@example.test', startsAt: new Date('2027-03-01T14:00:00Z'), consentVersion: 'DRAFT-2026-11' })
  const intentId = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: id }, { channel: 'EMAIL', address: 'public@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  expect(await deliver(intentId, now, adapter)).toMatchObject({ status: 'OPTED_OUT' })
})

it('does not grant portal access as a side effect of public booking notice processing', async () => {
  const id = randomUUID()
  await db.insert(bookingRequest).values({ id, source: 'PUBLIC', childName: 'Niña externa', guardianName: 'Representante', email: 'public@example.test', startsAt: new Date('2027-03-01T14:00:00Z'), consentVersion: 'DRAFT-2026-11' })
  const priorGrants = await db.select().from(guardianGrant)
  await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: id }, { channel: 'EMAIL', address: 'public@example.test' }))
  await processNotificationOutbox()
  expect(await db.select().from(guardianGrant)).toEqual(priorGrants)
})

it('does not emit a sent attempt for an opted-out account', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'OPTED_OUT' })
  expect(await db.select().from(notificationAttempt)).toHaveLength(0)
})

it('does not claim success for an unconfigured WhatsApp delivery after a worker poll', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'WHATSAPP', address: '+593991234567' }))
  expect(await processNotificationOutbox()).toBe(1)
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.state).toBe('NOT_CONFIGURED')
  expect(await db.select().from(inAppNotice)).toHaveLength(0)
})

it('does not expose a clinical visit to a guardian after account revocation during worker downtime', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id))
  expect(await deliver(row!.id)).toMatchObject({ status: 'OPTED_OUT' })
  expect(await listInAppNotices(guardian)).toHaveLength(0)
})

it('does not create a notice if the visit transaction is rolled back', async () => {
  const subjectId = randomUUID()
  await expect(db.transaction(async (tx) => {
    await queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId }, { channel: 'EMAIL', address: 'public@example.test' })
    throw new Error('rollback')
  })).rejects.toThrow('rollback')
  expect(await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, subjectId))).toHaveLength(0)
})

it('does not expose a revoked guardian booking on a later list request', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === booked.id)).toBe(false)
})

it('does not leak clinical identifiers in external recipient keys', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'VISIT_RECORDED', subjectId: snapshot.id }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id))
  expect(row?.recipientKey).not.toContain(child)
  expect(row?.recipientKey).not.toContain(snapshot.id)
})

it('does not leak an appointment reason to an external provider', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  let sent: unknown
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async (input: unknown) => {
    sent = input
    return 'SENT' as const
  } }
  await deliver(id, now, adapter)
  expect(JSON.stringify(sent)).not.toContain('reason')
})

it('does not allow a public booking email to become a verified guardian identity', async () => {
  const id = randomUUID()
  await db.insert(bookingRequest).values({ id, source: 'PUBLIC', childName: 'Niña externa', guardianName: 'Representante', email: 'family@example.test', startsAt: new Date('2027-03-01T14:00:00Z'), consentVersion: 'DRAFT-2026-11' })
  await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: id }, { channel: 'EMAIL', address: 'family@example.test' }))
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, id))
  expect(row?.recipientUserId).toBeNull()
})

it('does not deliver in-app until the transaction committing its intent has completed', async () => {
  const subjectId = randomUUID()
  await db.transaction(async (tx) => {
    await queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId }, { channel: 'EMAIL', address: 'public@example.test' })
    expect(await processNotificationOutbox()).toBe(0)
  })
  expect(await processNotificationOutbox()).toBe(1)
})

it('does not count a rollback as a queued intent after restart', async () => {
  await expect(db.transaction(async (tx) => {
    await queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' })
    throw new Error('abort')
  })).rejects.toThrow('abort')
  expect(await reconcileNotificationOutbox()).toBe(0)
  expect(await processNotificationOutbox()).toBe(0)
})

it('does not report a failed attempt as delivered', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'FAILED' as const }
  await deliver(id, now, adapter)
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.deliveredAt).toBeNull()
})

it('does not allow a private note to leak into a booking notification adapter', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  let input: unknown
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async (value: unknown) => {
    input = value
    return 'SENT' as const
  } }
  await deliver(id, now, adapter)
  expect(JSON.stringify(input)).not.toContain('privateNote')
})

it('does not expose a notification after its guardian grant is suspended', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  await db.update(guardianGrant).set({ status: 'FAILED' }).where(eq(guardianGrant.patientId, child))
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === booked.id)).toBe(false)
})

it('does not create a notice for an invalid booking recipient UUID', async () => {
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'IN_APP', userId: randomUUID() }))).rejects.toThrow()
})

it('does not create a successful attempt without a corresponding outbox row', async () => {
  expect(await deliver(randomUUID())).toMatchObject({ status: 'NOT_FOUND' })
  expect(await db.select().from(notificationAttempt)).toHaveLength(0)
})

it('does not duplicate a notification attempt after an already sent message is polled', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
  await deliver(row!.id)
  expect(await db.select().from(notificationAttempt).where(eq(notificationAttempt.outboxId, row!.id))).toHaveLength(1)
})

it('does not expose an unshared visit in the parent notice list', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45, shareWithFamily: false })
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === snapshot.id)).toBe(false)
})

it('does not send a WhatsApp notice with an invalid unverified account mapping', async () => {
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'WHATSAPP', userId: guardian.id, address: '+593991234567' }))).rejects.toThrow()
  expect(await db.select().from(notificationOutbox)).toHaveLength(0)
})

it('does not send an external email if the account email changes after queue', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  await db.update(user).set({ email: 'changed@example.test' }).where(eq(user.id, guardian.id))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'FAILED' })
})

it('does not leak a changed account email on a failed delivery record', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  await db.update(user).set({ email: 'changed@example.test' }).where(eq(user.id, guardian.id))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  await deliver(id, now, adapter)
  expect(JSON.stringify(await db.select().from(notificationAttempt))).not.toContain('changed@example.test')
})

it('does not treat a missing provider adapter as a sent attempt', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  await deliver(id)
  expect((await db.select().from(notificationAttempt))[0]?.outcome).toBe('NOT_CONFIGURED')
})

it('does not count a transient retry as a sent attempt', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'RETRY' as const }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'RETRY' })
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.deliveredAt).toBeNull()
})

it('does not lose attempt history when a retry succeeds', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  let attempts = 0
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => ++attempts === 1 ? 'RETRY' as const : 'SENT' as const }
  await deliver(id, now, adapter)
  await deliver(id, new Date(now.getTime() + 60000), adapter)
  expect((await db.select().from(notificationAttempt).where(eq(notificationAttempt.outboxId, id)))).toHaveLength(2)
})

it('does not silently retry after three retryable failures', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'RETRY' as const }
  await deliver(id, now, adapter)
  await deliver(id, new Date(now.getTime() + 60000), adapter)
  expect(await deliver(id, new Date(now.getTime() + 180000), adapter)).toMatchObject({ status: 'FAILED' })
  expect(await processNotificationOutbox(new Date(now.getTime() + 3600000))).toBe(0)
})

it('does not reveal a private note in an outbox failure', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45, privateNote: 'SECRET-PATIENT-HISTORY' })
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id))
  expect(await deliver(row!.id)).toMatchObject({ status: 'SENT' })
  expect(JSON.stringify(await db.select().from(notificationOutbox))).not.toContain('SECRET-PATIENT-HISTORY')
})

it('does not interpret an email address as a verified guardian user ID', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'family@example.test' }))
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id))
  expect(row?.recipientUserId).toBeNull()
})

it('does not send a WhatsApp message without explicit provider configuration', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'WHATSAPP', address: '+593991234567' }))
  expect(await deliver(id)).toMatchObject({ status: 'NOT_CONFIGURED' })
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.deliveredAt).toBeNull()
})

it('does not mark a postponed message as sent merely because it entered the queue', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const outside = new Date(Date.now() + 86400000)
  outside.setUTCHours(2, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  await deliver(id, outside, adapter)
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.state).toBe('QUEUED')
})

it('does not queue a private visit for a verified guardian even when their booking exists', async () => {
  await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45, shareWithFamily: false })
  expect(await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id))).toHaveLength(0)
})

it('does not send an in-app notice to an account that is not linked to the patient', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  const stranger = randomUUID()
  await db.insert(user).values({ id: stranger, name: 'Desconocido', email: `${stranger}@example.test` })
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'VISIT_RECORDED', subjectId: snapshot.id }, { channel: 'IN_APP', userId: stranger }))).rejects.toThrow()
})

it('does not keep pending intent when the same booking request is already closed', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await db.update(bookingRequest).set({ status: 'DECLINED' }).where(eq(bookingRequest.id, booked.id))
  await expect(decideBookingRequest(doctor, booked.id, 'APPROVE')).rejects.toThrow()
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))).map(row => row.eventKind)).toEqual(['BOOKING_PENDING'])
})

it('does not send when opt-in was removed while a retry was waiting', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'RETRY' as const }
  await deliver(id, now, adapter)
  await db.update(notificationPreference).set({ enabled: false }).where(eq(notificationPreference.userId, guardian.id))
  expect(await deliver(id, new Date(now.getTime() + 60000), adapter)).toMatchObject({ status: 'OPTED_OUT' })
})

it('does not auto-resume a failed external send without operator intervention', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  await db.update(notificationOutbox).set({ state: 'FAILED', errorClass: 'DeliveryUncertain' }).where(eq(notificationOutbox.id, id))
  expect(await processNotificationOutbox()).toBe(0)
})

it('does not mark an interrupted send as sent after recovery', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  await db.update(notificationOutbox).set({ state: 'SENDING' }).where(eq(notificationOutbox.id, id))
  expect(await reconcileNotificationOutbox()).toBe(1)
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.deliveredAt).toBeNull()
})

it('does not leak account email into the outbox after address change', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  await db.update(user).set({ email: 'changed@example.test' }).where(eq(user.id, guardian.id))
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id))
  expect(JSON.stringify(row)).not.toContain('changed@example.test')
})

it('does not retry a sent external notice when the worker is restarted', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  await deliver(id, now, adapter)
  expect(await reconcileNotificationOutbox()).toBe(0)
  expect(await processNotificationOutbox(new Date(now.getTime() + 60000))).toBe(0)
})

it('does not send an external notice for an in-app only event without consent', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  const intents = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
  expect(intents.map(row => row.channel)).toEqual(['IN_APP'])
})

it('does not mark an outbox notification as sent if the provider status is unavailable', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  expect(await deliver(id)).toMatchObject({ status: 'NOT_CONFIGURED' })
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.deliveredAt).toBeNull()
})

it('does not create an in-app notice when a user has opted out before enqueue', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'IN_APP', enabled: false })
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  expect((await db.select().from(inAppNotice).where(eq(inAppNotice.subjectId, booked.id)))).toHaveLength(0)
})

it('does not accidentally use the notification outbox as a grant table', async () => {
  const before = await db.select().from(guardianGrant)
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id)))).toHaveLength(1)
  expect(await db.select().from(guardianGrant)).toEqual(before)
})

it('does not expose an unknown subject through the parent notice feed', async () => {
  const outboxId = randomUUID()
  const subjectId = randomUUID()
  await db.insert(notificationOutbox).values({ id: outboxId, eventKind: 'BOOKING_PENDING', subjectId, channel: 'IN_APP', recipientKey: guardian.id, recipientUserId: guardian.id })
  await db.insert(inAppNotice).values({ id: randomUUID(), outboxId, userId: guardian.id, eventKind: 'BOOKING_PENDING', subjectId })
  expect(await listInAppNotices(guardian)).toHaveLength(0)
})

it('does not expose an unknown visit subject through the parent notice feed', async () => {
  const outboxId = randomUUID()
  const subjectId = randomUUID()
  await db.insert(notificationOutbox).values({ id: outboxId, eventKind: 'VISIT_RECORDED', subjectId, channel: 'IN_APP', recipientKey: guardian.id, recipientUserId: guardian.id })
  await db.insert(inAppNotice).values({ id: randomUUID(), outboxId, userId: guardian.id, eventKind: 'VISIT_RECORDED', subjectId })
  expect(await listInAppNotices(guardian)).toHaveLength(0)
})

it('does not expose an in-app notice after revocation even if the outbox remains sent', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await processNotificationOutbox()
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === snapshot.id)).toBe(false)
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id)))[0]?.state).toBe('SENT')
})

it('does not send a clinic visit email without explicit account preference', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'VISIT_RECORDED', subjectId: snapshot.id }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'OPTED_OUT' })
})

it('does not send external booking notice when preference is explicitly false', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: false })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'OPTED_OUT' })
})

it('does not send external messages during quiet hours even with explicit opt-in', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const future = new Date(Date.now() + 86400000)
  future.setUTCHours(2, 0, 0, 0)
  let called = false
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => {
    called = true
    return 'SENT' as const
  } }
  expect(await deliver(id, future, adapter)).toMatchObject({ status: 'DEFERRED' })
  expect(called).toBe(false)
})

it('does not create an in-app notice for a public contact after worker recovery', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  await reconcileNotificationOutbox()
  await processNotificationOutbox()
  expect(await db.select().from(inAppNotice)).toHaveLength(0)
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.state).toBe('NOT_CONFIGURED')
})

it('does not count a queued intent as delivered before the worker runs', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
  expect(row).toMatchObject({ state: 'QUEUED', attempts: 0, deliveredAt: null })
})

it('does not mark an in-app notice sent if a guardian grant is revoked before worker processing', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  await processNotificationOutbox()
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id)))[0]?.state).toBe('OPTED_OUT')
})

it('does not leak an appointment reason in notification attempt records', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  const attempts = await db.select().from(notificationAttempt)
  expect(attempts).toHaveLength(1)
  expect(JSON.stringify(attempts)).not.toContain('reason')
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id)))[0]?.state).toBe('SENT')
})

it('does not duplicate a booking notice when the queue worker polls twice', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  await processNotificationOutbox()
  expect(await db.select().from(inAppNotice).where(eq(inAppNotice.subjectId, booked.id))).toHaveLength(1)
})

it('does not create a notification for a booking request with invalid consent', async () => {
  await expect(submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: false, consentVersion: 'DRAFT-2026-11' })).rejects.toThrow()
  expect(await db.select().from(notificationOutbox)).toHaveLength(0)
})

it('does not send external notifications when a provider adapter is absent', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  expect(await deliver(id)).toMatchObject({ status: 'NOT_CONFIGURED' })
})

it('does not confuse a booking proof email with a portal session', async () => {
  const id = randomUUID()
  await db.insert(bookingRequest).values({ id, source: 'PUBLIC', childName: 'Niña externa', guardianName: 'Representante', email: 'family@example.test', startsAt: new Date('2027-03-01T14:00:00Z'), consentVersion: 'DRAFT-2026-11' })
  await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: id }, { channel: 'EMAIL', address: 'family@example.test' }))
  expect(await listInAppNotices(guardian)).toEqual([])
})

it('does not send private notes to in-app recipients during a visit replay', async () => {
  const input = { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT' as const, headCircumferenceCm: 45, privateNote: 'secret note' }
  const snapshot = await createVisit(doctor, child, input)
  await createVisit(doctor, child, input)
  await processNotificationOutbox()
  const notices = await db.select().from(inAppNotice).where(eq(inAppNotice.subjectId, snapshot.id))
  expect(notices).toHaveLength(1)
  expect(JSON.stringify(notices)).not.toContain('secret note')
})

it('does not make a private visit shareable by recording its notice intent', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45, shareWithFamily: false })
  expect(await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id))).toHaveLength(0)
})

it('does not expose a notice to a guardian after permission is removed even if it is unread', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await processNotificationOutbox()
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === snapshot.id)).toBe(false)
})

it('does not send a notification for a visit with no active guardian', async () => {
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  expect(await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id))).toHaveLength(0)
})

it('does not create a second outbox row after an idempotent visit replay', async () => {
  const input = { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT' as const, headCircumferenceCm: 45 }
  await createVisit(doctor, child, input)
  await createVisit(doctor, child, input)
  expect(await db.select().from(notificationOutbox)).toHaveLength(1)
})

it('does not create a portal account when a public booking notification is delivered', async () => {
  const id = randomUUID()
  await db.insert(bookingRequest).values({ id, source: 'PUBLIC', childName: 'Niña externa', guardianName: 'Representante', email: 'public@example.test', startsAt: new Date('2027-03-01T14:00:00Z'), consentVersion: 'DRAFT-2026-11' })
  const initialUsers = await db.select().from(user)
  await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: id }, { channel: 'EMAIL', address: 'public@example.test' }))
  await processNotificationOutbox()
  expect(await db.select().from(user)).toEqual(initialUsers)
})

it('does not send a visit notification when shareWithFamily is explicitly false', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45, shareWithFamily: false })
  expect(await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id))).toHaveLength(0)
})

it('does not send external notices with raw patient names', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'VISIT_RECORDED', subjectId: snapshot.id }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  let payload = ''
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async (input: unknown) => {
    payload = JSON.stringify(input)
    return 'SENT' as const
  } }
  await deliver(id, now, adapter)
  expect(payload).not.toContain('Paciente privado')
})

it('does not make an outbox row visible to a guardian merely by matching their email hash', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'family@example.test' }))
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.recipientUserId).toBeNull()
  expect(await listInAppNotices(guardian)).toEqual([])
})

it('does not send a clinical visit without checking current sharing after a worker outage', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await db.insert(visitSharing).values({ visitId: snapshot.id, shared: false, changedBy: doctor.id })
  await reconcileNotificationOutbox()
  await processNotificationOutbox()
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id)))[0]?.state).toBe('OPTED_OUT')
})

it('does not leak a guardian phone in outbox records', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'WHATSAPP', address: '+593991234567' }))
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id))
  expect(JSON.stringify(row)).not.toContain('+593991234567')
})

it('does not create duplicate notices when Valkey is unavailable', async () => {
  const priorRedis = process.env.REDIS_URL
  process.env.REDIS_URL = 'redis://127.0.0.1:1'
  try {
    const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
    await processNotificationOutbox()
    await processNotificationOutbox()
    expect(await db.select().from(inAppNotice).where(eq(inAppNotice.subjectId, booked.id))).toHaveLength(1)
  } finally {
    process.env.REDIS_URL = priorRedis
  }
})

it('does not turn an unconfigured provider state into success on a second call', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  expect(await deliver(id)).toMatchObject({ status: 'NOT_CONFIGURED' })
  expect(await deliver(id)).toMatchObject({ status: 'NOT_CONFIGURED' })
})

it('does not send a notice to a guardian whose grant changed to pending before delivery', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await db.update(guardianGrant).set({ status: 'PENDING' }).where(eq(guardianGrant.patientId, child))
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id))
  expect(await deliver(row!.id)).toMatchObject({ status: 'OPTED_OUT' })
})

it('does not expose clinician trend text to an in-app notice', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45, clinicianTrend: 'SECRET-TREND' })
  await processNotificationOutbox()
  expect(JSON.stringify(await db.select().from(inAppNotice).where(eq(inAppNotice.subjectId, snapshot.id)))).not.toContain('SECRET-TREND')
})

it('does not reveal parent advice through an external provider event', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45, parentAdvice: 'PRIVATE-ADVICE' })
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'VISIT_RECORDED', subjectId: snapshot.id }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  let payload: unknown
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async (input: unknown) => {
    payload = input
    return 'SENT' as const
  } }
  await deliver(id, now, adapter)
  expect(JSON.stringify(payload)).not.toContain('PRIVATE-ADVICE')
})

it('does not permit a malformed recipient channel even when a user ID is present', async () => {
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'PUSH' as 'EMAIL', userId: guardian.id, address: 'family@example.test' }))).rejects.toThrow()
})

it('does not persist contact address when a notification is queued', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'private@example.test' }))
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id))
  expect(row?.address).toBeNull()
})

it('does not send WhatsApp without a verified guardian phone', async () => {
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'WHATSAPP', userId: guardian.id, address: '+593991234567' }))).rejects.toThrow()
})

it('does not leak the guardian email when provider is not configured', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'family@example.test' }))
  await deliver(id)
  expect(JSON.stringify(await db.select().from(notificationOutbox))).not.toContain('family@example.test')
})

it('does not persist an unsupported event kind to the outbox', async () => {
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'DIAGNOSIS' as 'VISIT_RECORDED', subjectId: randomUUID() }, { channel: 'IN_APP', userId: guardian.id }))).rejects.toThrow()
  expect(await db.select().from(notificationOutbox)).toHaveLength(0)
})

it('does not persist a blank subject in an outbox event', async () => {
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: '' }, { channel: 'EMAIL', address: 'public@example.test' }))).rejects.toThrow()
})

it('does not expose a patient record when an invalid actor lists notices', async () => {
  const actor: Actor = { id: randomUUID(), roles: ['ADMIN'] }
  expect(await listInAppNotices(actor)).toEqual([])
})

it('does not send to another email if the user account address changed', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  await db.update(user).set({ email: 'other@example.test' }).where(eq(user.id, guardian.id))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  let called = false
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => {
    called = true
    return 'SENT' as const
  } }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'FAILED' })
  expect(called).toBe(false)
})

it('does not expose the recipient key to the in-app feed', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  const notices = await listInAppNotices(guardian)
  expect(notices.some(row => row.subjectId === booked.id)).toBe(true)
  expect(notices.every(row => !('recipientKey' in row))).toBe(true)
})

it('does not expose provider status as READY for a missing adapter', async () => {
  expect(providerStatus('EMAIL')).toBe('NOT_CONFIGURED')
  expect(providerStatus('WHATSAPP')).toBe('NOT_CONFIGURED')
})

it('does not treat a booking status change as a clinical visit event', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))).map(row => row.eventKind)).toEqual(['BOOKING_PENDING'])
})

it('does not create a duplicate in-app notice after a delivery retry', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
  await deliver(row!.id)
  await deliver(row!.id)
  expect(await db.select().from(inAppNotice).where(eq(inAppNotice.subjectId, booked.id))).toHaveLength(1)
})

it('does not persist a raw patient name in a visit outbox entry', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  expect(JSON.stringify(await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id)))).not.toContain('Paciente privado')
})

it('does not create a notification for a booking request without a valid guardian', async () => {
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  await expect(submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })).rejects.toThrow()
  expect(await db.select().from(notificationOutbox)).toHaveLength(0)
})

it('does not expose a private visit to a guardian with an active account', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45, shareWithFamily: false })
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === snapshot.id)).toBe(false)
})

it('does not create a public booking portal notification when an email was verified', async () => {
  const id = randomUUID()
  await db.insert(bookingRequest).values({ id, source: 'PUBLIC', childName: 'Niña externa', guardianName: 'Representante', email: 'family@example.test', startsAt: new Date('2027-03-01T14:00:00Z'), consentVersion: 'DRAFT-2026-11' })
  await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: id }, { channel: 'EMAIL', address: 'family@example.test' }))
  expect(await listInAppNotices(guardian)).toHaveLength(0)
})

it('does not deliver a notice to a guardian after their relationship is revoked', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
  expect(await deliver(row!.id)).toMatchObject({ status: 'OPTED_OUT' })
})

it('does not duplicate delivery attempts after a public booking is re-queued', async () => {
  const event = { kind: 'BOOKING_PENDING' as const, subjectId: randomUUID() }
  const recipient = { channel: 'EMAIL' as const, address: 'public@example.test' }
  const id = await db.transaction(tx => queueNotification(tx, event, recipient))
  await deliver(id)
  await db.transaction(tx => queueNotification(tx, event, recipient))
  expect(await db.select().from(notificationAttempt).where(eq(notificationAttempt.outboxId, id))).toHaveLength(1)
})

it('does not expose raw external recipient data to the portal notice feed', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'private@example.test' }))
  await deliver(id)
  expect(JSON.stringify(await listInAppNotices(guardian))).not.toContain('private@example.test')
})

it('does not treat the first outbox insert as a delivered message', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id))
  expect(row).toMatchObject({ state: 'QUEUED', deliveredAt: null, attempts: 0 })
})

it('does not fabricate successful email delivery when only the in-app channel works', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  const rows = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
  expect(rows).toHaveLength(1)
  expect(rows[0]?.channel).toBe('IN_APP')
  expect(rows[0]?.state).toBe('SENT')
})

it('does not accidentally send an external notification during a database migration', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.state).toBe('QUEUED')
})

it('does not expose a visit notice to a different authenticated patient', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await processNotificationOutbox()
  expect((await listInAppNotices({ id: randomUUID(), roles: ['PATIENT'] })).some(row => row.subjectId === snapshot.id)).toBe(false)
})

it('does not allow a scheduling assistant to read a patient notice', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  expect((await listInAppNotices({ id: guardian.id, roles: ['ASSISTANT'] })).some(row => row.subjectId === booked.id)).toBe(false)
})

it('does not let a booking proof token grant access through an outbox entry', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  await deliver(id)
  expect(await listInAppNotices({ id: randomUUID(), roles: ['PATIENT'] })).toEqual([])
})

it('does not send a notification if the event type is not allowlisted', async () => {
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'PRIVATE_NOTE' as 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))).rejects.toThrow()
})

it('does not allow an unauthenticated in-app recipient', async () => {
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'IN_APP', userId: '' }))).rejects.toThrow()
})

it('does not persist an empty event identifier', async () => {
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'VISIT_RECORDED', subjectId: '' }, { channel: 'IN_APP', userId: guardian.id }))).rejects.toThrow()
})

it('does not store an opt-in as a side effect of delivery', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  await deliver(id)
  expect(await db.select().from(notificationPreference)).toHaveLength(0)
})

it('does not resume an uncertain send without manual investigation', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  await db.update(notificationOutbox).set({ state: 'SENDING' }).where(eq(notificationOutbox.id, id))
  await reconcileNotificationOutbox()
  expect(await deliver(id)).toMatchObject({ status: 'FAILED' })
})

it('does not allow a booking notice to be read by a different guardian despite the same email domain', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  const stranger: Actor = { id: randomUUID(), roles: ['PATIENT'] }
  expect((await listInAppNotices(stranger)).some(row => row.subjectId === booked.id)).toBe(false)
})

it('does not expose outbox metadata to an assistant in the notice list', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  expect((await listInAppNotices({ id: guardian.id, roles: ['ASSISTANT'] })).some(row => row.subjectId === booked.id)).toBe(false)
})

it('does not expose a rejected provider send as an in-app delivery', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'FAILED' as const }
  await deliver(id, now, adapter)
  expect(await db.select().from(inAppNotice)).toHaveLength(0)
})

it('does not expose invitation or recovery tokens through notification payloads', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id))
  expect(row).not.toHaveProperty('token')
  expect(row).not.toHaveProperty('payload')
})

it('does not create a notice when a booking proof email is not associated with a guardian grant', async () => {
  const id = randomUUID()
  await db.insert(bookingRequest).values({ id, source: 'PUBLIC', childName: 'Niña externa', guardianName: 'Representante', email: 'public@example.test', startsAt: new Date('2027-03-01T14:00:00Z'), consentVersion: 'DRAFT-2026-11' })
  await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: id }, { channel: 'EMAIL', address: 'public@example.test' }))
  expect(await listInAppNotices(guardian)).toHaveLength(0)
})

it('does not treat notification preference as guardian identity proof', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = randomUUID()
  await db.insert(bookingRequest).values({ id, source: 'PUBLIC', childName: 'Niña externa', guardianName: 'Representante', email: 'family@example.test', startsAt: new Date('2027-03-01T14:00:00Z'), consentVersion: 'DRAFT-2026-11' })
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: id }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))).rejects.toThrow()
})

it('does not send an external notice when the account opted in for another channel only', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'WHATSAPP', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'OPTED_OUT' })
})

it('does not deliver a queued visit after sharing was toggled off', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await db.insert(visitSharing).values({ visitId: snapshot.id, shared: false, changedBy: doctor.id })
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id))
  expect(await deliver(row!.id)).toMatchObject({ status: 'OPTED_OUT' })
})

it('does not expose an in-app visit notice after sharing is disabled', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await processNotificationOutbox()
  await db.insert(visitSharing).values({ visitId: snapshot.id, shared: false, changedBy: doctor.id })
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === snapshot.id)).toBe(false)
})

it('does not queue a visit notification for a guardian grant that is not active', async () => {
  await db.update(guardianGrant).set({ status: 'FAILED' }).where(eq(guardianGrant.patientId, child))
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  expect(await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id))).toHaveLength(0)
})

it('does not leak medical measurements through provider event arguments', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'VISIT_RECORDED', subjectId: snapshot.id }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  let payload = ''
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async (input: unknown) => {
    payload = JSON.stringify(input)
    return 'SENT' as const
  } }
  await deliver(id, now, adapter)
  expect(payload).not.toContain('weightKg')
  expect(payload).not.toContain('headCircumferenceCm')
})

it('does not accidentally retry a provider after successful send', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  let calls = 0
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => {
    calls++
    return 'SENT' as const
  } }
  await deliver(id, now, adapter)
  await deliver(id, now, adapter)
  expect(calls).toBe(1)
})

it('does not lose in-app notices after a PostgreSQL-backed worker restart', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  await reconcileNotificationOutbox()
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === booked.id)).toBe(true)
})

it('does not expose another guardian’s visit notice after role changes', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await processNotificationOutbox()
  expect((await listInAppNotices({ id: randomUUID(), roles: ['PATIENT'] })).some(row => row.subjectId === snapshot.id)).toBe(false)
})

it('does not deliver a booking notice to an account after grant revocation', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
  expect(await deliver(row!.id)).toMatchObject({ status: 'OPTED_OUT' })
})

it('does not create a sent event for a deferred delivery', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const future = new Date(Date.now() + 86400000)
  future.setUTCHours(2, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  await deliver(id, future, adapter)
  expect(await db.select().from(notificationAttempt)).toHaveLength(0)
})

it('does not count an unconfigured provider attempt as successful notification', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  await deliver(id)
  expect((await db.select().from(notificationAttempt))[0]?.outcome).not.toBe('SENT')
})

it('does not deliver to a retired external contact from old booking data', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  await db.update(user).set({ email: 'new@example.test' }).where(eq(user.id, guardian.id))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'FAILED' })
})

it('does not create an in-app notice for an external EMAIL intent', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  await deliver(id)
  expect(await db.select().from(inAppNotice)).toHaveLength(0)
})

it('does not create an in-app notice for an external WhatsApp intent', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'WHATSAPP', address: '+593991234567' }))
  await deliver(id)
  expect(await db.select().from(inAppNotice)).toHaveLength(0)
})

it('does not reveal an external recipient address in a failed attempt', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'private@example.test' }))
  await deliver(id)
  expect(JSON.stringify(await db.select().from(notificationAttempt))).not.toContain('private@example.test')
})

it('does not create new portal access from a notification preference row', async () => {
  const before = await db.select().from(guardianGrant)
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  expect(await db.select().from(guardianGrant)).toEqual(before)
})

it('does not turn an opted-out in-app notice into a sent status on polling', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'IN_APP', enabled: false })
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
  expect(row?.state).toBe('OPTED_OUT')
  expect(row?.deliveredAt).toBeNull()
})

it('does not lose a PostgreSQL outbox event when Valkey is down', async () => {
  const priorRedis = process.env.REDIS_URL
  process.env.REDIS_URL = 'redis://127.0.0.1:1'
  try {
    const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
    expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id)))).toHaveLength(1)
  } finally {
    process.env.REDIS_URL = priorRedis
  }
})

it('does not send an in-app notice before the booking transaction commits', async () => {
  const subjectId = randomUUID()
  await db.transaction(async (tx) => {
    await queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId }, { channel: 'EMAIL', address: 'public@example.test' })
    expect(await processNotificationOutbox()).toBe(0)
  })
})

it('does not create a duplicate booking intent if queueNotification is retried', async () => {
  const event = { kind: 'BOOKING_PENDING' as const, subjectId: randomUUID() }
  const recipient = { channel: 'EMAIL' as const, address: 'public@example.test' }
  await db.transaction(tx => queueNotification(tx, event, recipient))
  await db.transaction(tx => queueNotification(tx, event, recipient))
  expect(await db.select().from(notificationOutbox)).toHaveLength(1)
})

it('does not send a notification from an uncommitted transaction after rollback', async () => {
  await expect(db.transaction(async (tx) => {
    await queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' })
    throw new Error('rollback')
  })).rejects.toThrow('rollback')
  expect(await processNotificationOutbox()).toBe(0)
})

it('does not store a password recovery token in a booking notification row', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id))
  expect(row).not.toHaveProperty('tokenId')
  expect(row).not.toHaveProperty('deliveryPayload')
})

it('does not interpret a queued booking email as an active guardian relationship', async () => {
  const id = randomUUID()
  await db.insert(bookingRequest).values({ id, source: 'PUBLIC', childName: 'Niña externa', guardianName: 'Representante', email: 'family@example.test', startsAt: new Date('2027-03-01T14:00:00Z'), consentVersion: 'DRAFT-2026-11' })
  await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: id }, { channel: 'EMAIL', address: 'family@example.test' }))
  expect((await db.select().from(bookingRequest).where(eq(bookingRequest.id, id)))[0]?.guardianId).toBeNull()
})

it('does not accidentally notify an admin about a patient visit', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await processNotificationOutbox()
  expect((await listInAppNotices({ id: guardian.id, roles: ['ADMIN'] })).some(row => row.subjectId === snapshot.id)).toBe(false)
})

it('does not expose a clinical visit notice after patient guardian relationship is revoked', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await processNotificationOutbox()
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === snapshot.id)).toBe(false)
})

it('does not expose a booking notice to a guardian without active permission', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === booked.id)).toBe(false)
})

it('does not treat an email sent by an unrelated provider as a valid delivery outcome', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  const adapter = { channel: 'WHATSAPP' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  expect(await deliver(id, new Date(Date.now() + 86400000), adapter)).toMatchObject({ status: 'NOT_CONFIGURED' })
})

it('does not allow a not-configured channel to report success after a duplicate request', async () => {
  const event = { kind: 'BOOKING_PENDING' as const, subjectId: randomUUID() }
  const recipient = { channel: 'WHATSAPP' as const, address: '+593991234567' }
  const id = await db.transaction(tx => queueNotification(tx, event, recipient))
  await deliver(id)
  expect(await db.transaction(tx => queueNotification(tx, event, recipient))).toBe(id)
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.state).toBe('NOT_CONFIGURED')
})

it('does not deliver an opted-out in-app notice after a preference change', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'IN_APP', enabled: false })
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
  expect(await deliver(row!.id)).toMatchObject({ status: 'OPTED_OUT' })
})

it('does not expose in-app notices to users without PATIENT role', async () => {
  expect(await listInAppNotices({ id: guardian.id, roles: ['ADMIN'] })).toEqual([])
})

it('does not leak a booking email in a portal notice after delivery', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  expect(JSON.stringify((await listInAppNotices(guardian)).filter(row => row.subjectId === booked.id))).not.toContain('family@example.test')
})

it('does not expose an in-app notice for an appointment without a matching booking request', async () => {
  const id = randomUUID()
  await db.insert(appointment).values({ id, patientId: child, name: 'Paciente privado', contact: 'family@example.test', reason: '', startsAt: new Date('2027-03-01T14:00:00Z'), endsAt: new Date('2027-03-01T14:30:00Z'), status: 'CONFIRMED', createdBy: doctor.id })
  await db.transaction(tx => recordBookingAppointmentChange(tx, id, 'CANCELLED'))
  expect(await db.select().from(notificationOutbox)).toHaveLength(0)
})

it('does not keep a duplicate booking intent after a transaction fails', async () => {
  const event = { kind: 'BOOKING_PENDING' as const, subjectId: randomUUID() }
  const recipient = { channel: 'EMAIL' as const, address: 'public@example.test' }
  await expect(db.transaction(async (tx) => {
    await queueNotification(tx, event, recipient)
    throw new Error('rollback')
  })).rejects.toThrow('rollback')
  const id = await db.transaction(tx => queueNotification(tx, event, recipient))
  expect((await db.select().from(notificationOutbox)).map(row => row.id)).toEqual([id])
})

it('does not allow an email provider to send a WhatsApp notice', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'WHATSAPP', address: '+593991234567' }))
  let called = false
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => {
    called = true
    return 'SENT' as const
  } }
  await deliver(id, new Date(Date.now() + 86400000), adapter)
  expect(called).toBe(false)
})

it('does not create a reminder send event from a booking notice', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  const rows = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
  expect(rows.map(row => row.eventKind)).toEqual(['BOOKING_PENDING'])
})

it('does not use a booking verification code as a notification idempotency key', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  expect(id).toMatch(/^[0-9a-f-]{36}$/)
})

it('does not permit a guardian to view a notice after the grant is revoked and requeued', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === booked.id)).toBe(false)
})

it('does not mark a notification sent when a provider throws after receiving a request', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => {
    throw new Error('connection reset after send')
  } }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'FAILED' })
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.deliveredAt).toBeNull()
})

it('does not retry a failed send without an explicit retryable result', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'FAILED' as const }
  await deliver(id, now, adapter)
  expect(await processNotificationOutbox(new Date(now.getTime() + 86400000))).toBe(0)
})

it('does not send an email when an account recipient address does not match', async () => {
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'other@example.test' }))).rejects.toThrow()
})

it('does not expose outbox failure state as a guardian notice', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  await deliver(id)
  expect(await listInAppNotices(guardian)).toEqual([])
})

it('does not claim provider readiness without an adapter', async () => {
  expect(providerStatus('EMAIL')).toBe('NOT_CONFIGURED')
})

it('does not mark a booking contact as a patient grant during notification processing', async () => {
  const id = randomUUID()
  await db.insert(bookingRequest).values({ id, source: 'PUBLIC', childName: 'Niña externa', guardianName: 'Representante', email: 'public@example.test', startsAt: new Date('2027-03-01T14:00:00Z'), consentVersion: 'DRAFT-2026-11' })
  await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: id }, { channel: 'EMAIL', address: 'public@example.test' }))
  await processNotificationOutbox()
  expect((await db.select().from(bookingRequest).where(eq(bookingRequest.id, id)))[0]?.patientId).toBeNull()
})

it('does not expose visit metadata through a booking notice', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await processNotificationOutbox()
  const [notice] = await db.select().from(inAppNotice).where(eq(inAppNotice.subjectId, booked.id))
  expect(notice).not.toHaveProperty('weightKg')
})

it('does not deliver to an opted-out guardian after a worker retry', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'IN_APP', enabled: false })
  await processNotificationOutbox()
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id)))[0]?.state).toBe('OPTED_OUT')
})

it('does not persist a provider credential in an outbox attempt', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  await deliver(id)
  const attempts = await db.select().from(notificationAttempt)
  expect(attempts[0]).not.toHaveProperty('credential')
})

it('does not create a second sent attempt after duplicate delivery', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
  await deliver(row!.id)
  await deliver(row!.id)
  expect((await db.select().from(notificationAttempt).where(eq(notificationAttempt.outboxId, row!.id))).map(item => item.outcome)).toEqual(['SENT'])
})

it('does not deliver a booking notice after the guardian grant becomes revoked', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
  expect(await deliver(row!.id)).toMatchObject({ status: 'OPTED_OUT' })
})

it('does not treat an in-app notice as a substitute for approved clinical sharing', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await processNotificationOutbox()
  await db.insert(visitSharing).values({ visitId: snapshot.id, shared: false, changedBy: doctor.id })
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === snapshot.id)).toBe(false)
})

it('does not send an unknown notification channel through a ready adapter', async () => {
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'SMS' as 'EMAIL', address: 'public@example.test' }))).rejects.toThrow()
})

it('does not store a raw patient ID as an external recipient key', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'VISIT_RECORDED', subjectId: snapshot.id }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id))
  expect(row?.recipientKey).not.toBe(child)
})

it('does not expose an in-app notice to a guardian without an active clinical grant', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await processNotificationOutbox()
  await db.update(guardianGrant).set({ status: 'FAILED' }).where(eq(guardianGrant.patientId, child))
  expect((await listInAppNotices(guardian)).some(row => row.subjectId === snapshot.id)).toBe(false)
})

it('does not send a notification while its row remains locked in a pending domain transaction', async () => {
  const subjectId = randomUUID()
  await db.transaction(async (tx) => {
    await queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId }, { channel: 'EMAIL', address: 'public@example.test' })
    expect(await processNotificationOutbox()).toBe(0)
  })
})

it('does not leak email from the booking request into the outbox', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
  expect(JSON.stringify(row)).not.toContain('family@example.test')
})

it('does not make an unavailable external provider look ready in provider status', async () => {
  expect(providerStatus('EMAIL')).not.toBe('READY')
  expect(providerStatus('WHATSAPP')).not.toBe('READY')
})

it('does not send a clinical notification if the guardian status changes during delivery downtime', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  await processNotificationOutbox()
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, snapshot.id)))[0]?.state).toBe('OPTED_OUT')
})

it('does not treat an opt-out as an error that can be retried', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'IN_APP', enabled: false })
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
  await deliver(row!.id)
  expect(await processNotificationOutbox()).toBe(0)
})

it('does not expose an outbox entry to an unauthenticated actor through the notice list', async () => {
  expect(await listInAppNotices({ id: randomUUID(), roles: [] })).toEqual([])
})

it('does not report SENT for a queued external message when provider is absent', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  expect(await deliver(id)).toMatchObject({ status: 'NOT_CONFIGURED' })
})

it('does not send an in-app notice when the recipient user is missing', async () => {
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'IN_APP', userId: randomUUID() }))).rejects.toThrow()
})

it('does not let an unconfigured provider send on a later worker tick', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  await processNotificationOutbox()
  expect(await processNotificationOutbox()).toBe(0)
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.state).toBe('NOT_CONFIGURED')
})

it('does not lose a pending in-app notice when Redis URL is invalid', async () => {
  const priorRedis = process.env.REDIS_URL
  process.env.REDIS_URL = 'redis://127.0.0.1:1'
  try {
    const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
    const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
    expect(row?.state).toBe('QUEUED')
  } finally {
    process.env.REDIS_URL = priorRedis
  }
})

it('does not send an external provider request for a public email with no opt-in', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'public@example.test' }))
  let called = false
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => {
    called = true
    return 'SENT' as const
  } }
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'OPTED_OUT' })
  expect(called).toBe(false)
})

it('does not send an external provider request when the guardian grant is revoked', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: booked.id }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  let called = false
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => {
    called = true
    return 'SENT' as const
  } }
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'OPTED_OUT' })
  expect(called).toBe(false)
})

it('does not send an external visit without a known recipient user', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45 })
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'VISIT_RECORDED', subjectId: snapshot.id }, { channel: 'EMAIL', address: 'public@example.test' }))).rejects.toThrow()
})

it('does not queue an in-app booking notice for a public request without a guardian', async () => {
  const id = randomUUID()
  await db.insert(bookingRequest).values({ id, source: 'PUBLIC', childName: 'Niña externa', guardianName: 'Representante', email: 'family@example.test', startsAt: new Date('2027-03-01T14:00:00Z'), consentVersion: 'DRAFT-2026-11' })
  await expect(db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: id }, { channel: 'IN_APP', userId: guardian.id }))).rejects.toThrow()
})

it('does not send a revoked guardian booking even if the intent remains queued', async () => {
  await db.update(guardianGrant).set({ status: 'ACTIVE' }).where(eq(guardianGrant.patientId, child))
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
  expect(await deliver(row!.id)).toMatchObject({ status: 'OPTED_OUT' })
  expect(await db.select().from(inAppNotice)).toHaveLength(0)
  await db.update(guardianGrant).set({ status: 'ACTIVE' }).where(eq(guardianGrant.patientId, child))
})

it('does not replay an in-flight claim before reconciliation', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  await db.update(notificationOutbox).set({ state: 'SENDING' }).where(eq(notificationOutbox.id, id))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'DEFERRED' })
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.state).toBe('SENDING')
})

it('does not automatically replay an uncertain provider outcome', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => {
    throw new Error('unknown transport result')
  } }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'FAILED' })
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'FAILED' })
  expect((await db.select().from(notificationAttempt)).map(row => row.outcome)).toEqual(['FAILED'])
  expect(await processNotificationOutbox(new Date(now.getTime() + 3600000))).toBe(0)
})

it('does not replay a provider that returned FAILED with an uncertain outcome', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  let calls = 0
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => {
    calls++
    return 'FAILED' as const
  } }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'FAILED' })
  expect(await deliver(id, new Date(now.getTime() + 60000), adapter)).toMatchObject({ status: 'FAILED' })
  expect(calls).toBe(1)
})

it('does not mark a delayed retry sent when no adapter is available on the next worker run', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'RETRY' as const }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'RETRY' })
  expect(await deliver(id, new Date(now.getTime() + 60000))).toMatchObject({ status: 'NOT_CONFIGURED' })
  expect((await db.select().from(notificationAttempt)).map(row => row.outcome)).toEqual(['RETRY', 'NOT_CONFIGURED'])
})

it('preserves a retryable record across worker restarts until its next attempt', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'RETRY' as const }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'RETRY' })
  expect(await reconcileNotificationOutbox()).toBe(0)
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.state).toBe('RETRY')
})

it('records a terminal uncertain outcome without exposing the provider error message', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => {
    throw new Error('sensitive provider token')
  } }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'FAILED' })
  expect(JSON.stringify({ rows: await db.select().from(notificationOutbox), attempts: await db.select().from(notificationAttempt) })).not.toContain('sensitive provider token')
})

it('keeps provider-visible event metadata restricted to booking identifiers', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const subjectId = randomUUID()
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  let event: unknown
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async (input: { event: unknown }) => {
    event = input.event
    return 'SENT' as const
  } }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'SENT' })
  expect(event).toEqual({ kind: 'BOOKING_APPROVED', subjectId })
})

it('does not let a provider observe clinical visit metadata beyond opaque identifiers', async () => {
  const snapshot = await createVisit(doctor, child, { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT', headCircumferenceCm: 45, privateNote: 'private diagnosis' })
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'VISIT_RECORDED', subjectId: snapshot.id }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  let event: unknown
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async (input: { event: unknown }) => {
    event = input.event
    return 'SENT' as const
  } }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'SENT' })
  expect(event).toEqual({ kind: 'VISIT_RECORDED', subjectId: snapshot.id })
})

it('retries only explicitly safe failures with stable idempotency key and records every attempt', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const keys: string[] = []
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async (input: { idempotencyKey: string }) => {
    keys.push(input.idempotencyKey)
    return keys.length === 1 ? 'RETRY' as const : 'SENT' as const
  } }
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'RETRY' })
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'DEFERRED' })
  expect(await deliver(id, new Date(now.getTime() + 60000), adapter)).toMatchObject({ status: 'SENT' })
  expect(await deliver(id, new Date(now.getTime() + 120000), adapter)).toMatchObject({ status: 'SENT' })
  expect(keys).toEqual([id, id])
  expect((await db.select().from(notificationAttempt)).map(row => row.outcome)).toEqual(['RETRY', 'SENT'])
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.attempts).toBe(2)
})

it('defers at 07:59 clinic time and resumes at 08:00', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const day = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  expect(await deliver(id, new Date(`${day}T12:59:00Z`), adapter)).toMatchObject({ status: 'DEFERRED' })
  expect(await deliver(id, new Date(`${day}T13:00:00Z`), adapter)).toMatchObject({ status: 'SENT' })
})

it('defers at 20:00 clinic time until the next 08:00 boundary', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const day = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const evening = new Date(`${day}T01:00:00Z`)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  expect(await deliver(id, evening, adapter)).toMatchObject({ status: 'DEFERRED' })
  expect(await deliver(id, new Date(evening.getTime() + 11 * 3600000 + 59 * 60000), adapter)).toMatchObject({ status: 'DEFERRED' })
  expect(await deliver(id, new Date(evening.getTime() + 12 * 3600000), adapter)).toMatchObject({ status: 'SENT' })
})

it('accepts delivery at 08:00 and defers at 20:00 clinic time', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const day = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  const morning = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  expect(await deliver(morning, new Date(`${day}T13:00:00Z`), adapter)).toMatchObject({ status: 'SENT' })
  const evening = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_DECLINED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  expect(await deliver(evening, new Date(`${day}T01:00:00Z`), adapter)).toMatchObject({ status: 'DEFERRED' })
})

it('never sends an external notice about a booking without its verified guardian grant', async () => {
  await db.update(guardianGrant).set({ status: 'ACTIVE' }).where(eq(guardianGrant.patientId, child))
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: booked.id }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, child))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  let sent = false
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => {
    sent = true
    return 'SENT' as const
  } }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'OPTED_OUT' })
  expect(sent).toBe(false)
})

it('does not treat an in-app opt-out as delivered', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'IN_APP', enabled: false })
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
  expect(await deliver(row!.id)).toMatchObject({ status: 'OPTED_OUT' })
  expect(await db.select().from(inAppNotice)).toHaveLength(0)
})

it('does not send to an external provider after a user opts out while queued', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  await db.update(notificationPreference).set({ enabled: false }).where(eq(notificationPreference.userId, guardian.id))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  let sent = false
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => {
    sent = true
    return 'SENT' as const
  } }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'OPTED_OUT' })
  expect(sent).toBe(false)
  expect(await db.select().from(notificationAttempt)).toHaveLength(0)
})

it('does not record an attempt for a deferred quiet-hour intent', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const future = new Date(Date.now() + 86400000)
  future.setUTCHours(2, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  expect(await deliver(id, future, adapter)).toMatchObject({ status: 'DEFERRED' })
  expect(await db.select().from(notificationAttempt)).toHaveLength(0)
})

it('does not call a provider that reports FAILED and retains explicit failure state', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  let called = false
  const adapter = { channel: 'EMAIL' as const, status: () => 'FAILED' as const, send: async () => {
    called = true
    return 'SENT' as const
  } }
  expect(await deliver(id, new Date(Date.now() + 86400000), adapter)).toMatchObject({ status: 'FAILED' })
  expect(called).toBe(false)
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.errorClass).toBe('ProviderFailed')
})

it('does not permit empty provider success to count as a send', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => undefined as never }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'FAILED' })
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.state).toBe('FAILED')
})

it('stops retrying after three explicit retryable attempts', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'RETRY' as const }
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'RETRY' })
  expect(await deliver(id, new Date(now.getTime() + 60000), adapter)).toMatchObject({ status: 'RETRY' })
  expect(await deliver(id, new Date(now.getTime() + 180000), adapter)).toMatchObject({ status: 'FAILED' })
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]).toMatchObject({ state: 'FAILED', attempts: 3 })
  expect(await db.select().from(notificationAttempt)).toHaveLength(3)
})

it('does not report a user with no external opt-in as a successful send', async () => {
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', userId: guardian.id, address: 'family@example.test' }))
  const now = new Date(Date.now() + 86400000)
  now.setUTCHours(13, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  expect(await deliver(id, now, adapter)).toMatchObject({ status: 'OPTED_OUT' })
  expect((await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]?.deliveredAt).toBeNull()
})

it('does not deliver an in-app notice to a user who revoked their preference before processing', async () => {
  const booked = await submitParentBooking(guardian, { patientId: child, date: '2027-03-01', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'IN_APP', enabled: false })
  const [row] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, booked.id))
  expect(await deliver(row!.id)).toMatchObject({ status: 'OPTED_OUT' })
  expect(await listInAppNotices(guardian)).toHaveLength(0)
})

it('respects opt-out and quiet hours 08:00–20:00 in clinic time without a false sent event', async () => {
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'IN_APP', enabled: false })
  const id = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_PENDING', subjectId: randomUUID() }, { channel: 'IN_APP', userId: guardian.id }))
  expect(await deliver(id)).toMatchObject({ status: 'OPTED_OUT' })
  expect(await db.select().from(inAppNotice)).toHaveLength(0)
  const external = await db.transaction(tx => queueNotification(tx, { kind: 'BOOKING_APPROVED', subjectId: randomUUID() }, { channel: 'EMAIL', address: 'family@example.test', userId: guardian.id }))
  await db.insert(notificationPreference).values({ userId: guardian.id, channel: 'EMAIL', enabled: true })
  const outside = new Date(Date.now() + 86400000)
  outside.setUTCHours(2, 0, 0, 0)
  const adapter = { channel: 'EMAIL' as const, status: () => 'READY' as const, send: async () => 'SENT' as const }
  expect(await deliver(external, outside, adapter)).toMatchObject({ status: 'DEFERRED' })
  expect(await deliver(external, new Date(outside.getTime() + 11 * 3600000), adapter)).toMatchObject({ status: 'SENT' })
})
