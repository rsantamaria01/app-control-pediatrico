import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import type { Actor } from '../../shared/types/access'
import { bookingRequest, bookingNotice, appointment } from '../../server/db/schema'
import { eq } from 'drizzle-orm'
import { saveAvailability } from '../../server/services/availability'
import { decideBookingRequest, listBookingRequests, listParentAppointments, submitBookingRequest, verifyBookingContact, issueBookingCode, submitParentBooking, pendingBookingCount } from '../../server/services/booking'
import { listShareableChildren } from '../../server/services/invitations'
import { rescheduleAppointment, cancelAppointment } from '../../server/services/appointments'

const configured = process.env.WHO_TEST_DATABASE_URL
if (!configured || !['/pediatrico_who_slice3_test', '/pediatrico_who_slice3_verify', '/pediatrico_who_slice3_guard', '/pediatrico_who_slice3_sealed_test'].includes(new URL(configured).pathname) || configured === process.env.DATABASE_URL) throw new Error('Dedicated WHO test database required')
const name = `pediatrico_booking_${randomUUID().replace(/-/g, '')}`
const target = new URL(configured)
target.pathname = `/${name}`
const admin = new URL(configured)
admin.pathname = '/postgres'
const adminPool = new Pool({ connectionString: admin.href })
const pool = new Pool({ connectionString: target.href })
const db = drizzle(pool)
const prior = process.env.DATABASE_URL
const doctor: Actor = { id: randomUUID(), roles: ['DOCTOR'] }
const assistant: Actor = { id: randomUUID(), roles: ['ASSISTANT'] }
const parent: Actor = { id: randomUUID(), roles: ['PATIENT'] }
const stranger: Actor = { id: randomUUID(), roles: ['PATIENT'] }
const adminOnly: Actor = { id: randomUUID(), roles: ['ADMIN'] }
const child = randomUUID()
const date = '2027-03-01'
const email = `booking-${randomUUID()}@example.test`
const input = { date, time: '09:00', childName: 'Niña de prueba', birthDate: '2024-01-01', sex: 'FEMALE' as const, guardianName: 'Representante de prueba', relationship: 'Madre', email, phone: '0991234567', consent: true, consentVersion: 'DRAFT-2026-11', verificationToken: 'invalid-verification-token' }
let created = false

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${name}"`)
  created = true
  process.env.DATABASE_URL = target.href
  await migrate(drizzle(pool), { migrationsFolder: './server/db/migrations' })
  await saveAvailability(doctor, { days: [{ weekday: 1, open: '09:00', close: '10:00' }], durationMinutes: 30, blocked: [] })
  for (const id of [parent.id, stranger.id]) await pool.query('INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)', [id, 'Familia de prueba', `${id}@example.test`])
  await pool.query('INSERT INTO patient (id, name, birth_date, sex, created_by) VALUES ($1,$2,$3,$4,$5)', [child, input.childName, input.birthDate, input.sex, doctor.id])
  await pool.query('INSERT INTO guardian_grant (patient_id, guardian_id, contact_email, proof, verified_by, status) VALUES ($1,$2,$3,$4,$5,$6)', [child, parent.id, `${parent.id}@example.test`, 'Identidad verificada presencialmente', doctor.id, 'ACTIVE'])
}, 120000)
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

describe('booking with isolated database', () => {
  it('requires delivered one-use contact proof and draft consent; never grants portal access', async () => {
    await expect(submitBookingRequest(input)).rejects.toMatchObject({ statusCode: 403 })
    await expect(issueBookingCode(email, '127.0.0.1', async () => {
      throw new Error('SMTP unavailable')
    })).rejects.toMatchObject({ statusCode: 503 })
    let code = ''
    await issueBookingCode(email, '127.0.0.2', async (_address, value) => {
      code = value
    })
    await expect(verifyBookingContact(email, '000000', '127.0.0.2')).rejects.toMatchObject({ statusCode: 403 })
    const token = await verifyBookingContact(email, code, '127.0.0.3')
    await expect(submitBookingRequest({ ...input, consent: false, verificationToken: token })).rejects.toThrow()
    const pending = await submitBookingRequest({ ...input, verificationToken: token })
    expect(pending).toMatchObject({ status: 'PENDING', date, time: '09:00' })
    expect((await db.select().from(bookingRequest).where(eq(bookingRequest.id, pending.id)))[0]).toMatchObject({ status: 'PENDING', patientId: null, guardianId: null })
    await expect(submitBookingRequest({ ...input, time: '09:30', verificationToken: token })).rejects.toMatchObject({ statusCode: 403 })
    expect(await listShareableChildren(stranger)).toEqual([])
    expect(await listParentAppointments(stranger)).toEqual([])
    await expect(submitBookingRequest({ ...input, verificationToken: 'invalid-verification-token' })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('limits contact challenges and rejects duplicate pending requests', async () => {
    const address = `limited-${randomUUID()}@example.test`
    let code = ''
    for (let index = 0; index < 3; index++) await issueBookingCode(address, `127.1.2.${index + 1}`, async (_, value) => {
      code = value
    })
    await expect(issueBookingCode(address, '127.1.2.4', async () => {})).rejects.toMatchObject({ statusCode: 429 })
    const token = await verifyBookingContact(address, code, '127.1.2.5')
    await expect(submitBookingRequest({ ...input, verificationToken: token })).rejects.toMatchObject({ statusCode: 403 })
    const first = await submitBookingRequest({ ...input, email: address, verificationToken: token })
    expect(first.status).toBe('PENDING')
    await expect(submitBookingRequest({ ...input, email: address, verificationToken: token })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('invalidates earlier codes and rejects a duplicate even with fresh contact proof', async () => {
    const address = `fresh-${randomUUID()}@example.test`
    let oldCode = ''
    await issueBookingCode(address, '127.8.8.1', async (_, value) => {
      oldCode = value
    })
    let code = ''
    await issueBookingCode(address, '127.8.8.2', async (_, value) => {
      code = value
    })
    await expect(verifyBookingContact(address, oldCode, '127.8.8.3')).rejects.toMatchObject({ statusCode: 403 })
    const token = await verifyBookingContact(address, code, '127.8.8.4')
    await submitBookingRequest({ ...input, email: address, childName: 'Duplicado', verificationToken: token })
    let freshCode = ''
    await issueBookingCode(address, '127.8.8.5', async (_, value) => {
      freshCode = value
    })
    const freshToken = await verifyBookingContact(address, freshCode, '127.8.8.6')
    await expect(submitBookingRequest({ ...input, email: address, childName: 'Duplicado', verificationToken: freshToken })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('keeps a parent request pending, checks active relationship and only returns own records', async () => {
    await expect(submitParentBooking(stranger, { patientId: child, date, time: '09:30', consent: true, consentVersion: 'DRAFT-2026-11' })).rejects.toMatchObject({ statusCode: 404 })
    await expect(submitParentBooking(adminOnly, { patientId: child, date, time: '09:30', consent: true, consentVersion: 'DRAFT-2026-11' })).rejects.toMatchObject({ statusCode: 403 })
    const pending = await submitParentBooking(parent, { patientId: child, date, time: '09:30', consent: true, consentVersion: 'DRAFT-2026-11' })
    expect(pending.status).toBe('PENDING')
    expect(await listParentAppointments(stranger)).toEqual([])
    expect((await listParentAppointments(parent)).map(item => item.status)).toEqual(['PENDING'])
    await expect(listParentAppointments(assistant)).rejects.toMatchObject({ statusCode: 403 })
    expect(await pendingBookingCount(doctor)).toBe(4)
    expect((await listBookingRequests(assistant)).every(row => !('patientId' in row) && !('birthDate' in row) && !('sex' in row))).toBe(true)
    await expect(listBookingRequests(adminOnly)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('serializes two approvals of a slot, audits the decision and persists notice intent', async () => {
    const other = `second-${randomUUID()}@example.test`
    let code = ''
    await issueBookingCode(other, '127.2.2.1', async (_, value) => {
      code = value
    })
    const token = await verifyBookingContact(other, code, '127.2.2.2')
    const pending = await submitBookingRequest({ ...input, email: other, childName: 'Otra niña', verificationToken: token })
    const requests = await listBookingRequests(doctor)
    const first = requests.find(item => item.childName === input.childName)!
    const outcome = await Promise.allSettled([decideBookingRequest(doctor, first.id, 'APPROVE'), decideBookingRequest(assistant, pending.id, 'APPROVE')])
    expect(outcome.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(outcome.filter(item => item.status === 'rejected')).toHaveLength(1)
    expect((await db.select().from(appointment).where(eq(appointment.startsAt, new Date('2027-03-01T14:00:00Z'))))).toHaveLength(1)
    expect(await pendingBookingCount(doctor)).toBe(4)
    const declined = await decideBookingRequest(assistant, pending.id === (outcome[1] as { value?: { requestId?: string } }).value?.requestId ? first.id : pending.id, 'DECLINE')
    expect(declined.status).toBe('DECLINED')
    const notices = await db.select().from(bookingNotice)
    expect(notices.map(item => item.status)).toEqual(expect.arrayContaining(['PENDING', 'APPROVED', 'DECLINED']))
    await expect(decideBookingRequest(adminOnly, first.id, 'APPROVE')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('shows only own staff-scheduled appointments alongside parent requests', async () => {
    const { scheduleAppointment } = await import('../../server/services/appointments')
    const created = await scheduleAppointment(doctor, { date: '2027-03-08', time: '09:00', name: input.childName, contact: input.phone, reason: 'Control', patientId: child })
    const secondChild = randomUUID()
    await pool.query('INSERT INTO patient (id, name, birth_date, sex, created_by) VALUES ($1,$2,$3,$4,$5)', [secondChild, 'Otra familia', input.birthDate, input.sex, doctor.id])
    await scheduleAppointment(doctor, { date: '2027-03-08', time: '09:30', name: 'Otra familia', contact: input.phone, reason: 'Privado', patientId: secondChild })
    const own = await listParentAppointments(parent)
    expect(own).toContainEqual({ id: created.id, name: input.childName, date: '2027-03-08', time: '09:00', status: 'APPROVED' })
    expect(own.some(item => item.name === 'Otra familia')).toBe(false)
    expect(await listParentAppointments(stranger)).toEqual([])
  })

  it('rejects stale parent approval after relationship revocation and rolls back a failed decision audit', async () => {
    const owned = (await listBookingRequests(doctor)).find(row => row.time === '09:30' && row.childName === input.childName)!
    await pool.query('UPDATE guardian_grant SET status = \'REVOKED\' WHERE patient_id = $1 AND guardian_id = $2', [child, parent.id])
    await expect(decideBookingRequest(doctor, owned.id, 'APPROVE')).rejects.toMatchObject({ statusCode: 409 })
    expect(await listParentAppointments(parent)).toEqual([])
    await pool.query('UPDATE guardian_grant SET status = \'ACTIVE\' WHERE patient_id = $1 AND guardian_id = $2', [child, parent.id])
    await pool.query(`CREATE FUNCTION reject_booking_decision() RETURNS trigger AS $$ BEGIN IF NEW.action = 'BOOKING_APPROVE' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`)
    await pool.query('CREATE TRIGGER reject_booking_decision BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION reject_booking_decision()')
    try {
      await expect(decideBookingRequest(doctor, owned.id, 'APPROVE')).rejects.toThrow()
      expect((await db.select().from(bookingRequest).where(eq(bookingRequest.id, owned.id)))[0]?.status).toBe('PENDING')
      expect((await db.select().from(appointment).where(eq(appointment.startsAt, new Date('2027-03-01T14:30:00Z'))))).toEqual([])
    } finally {
      await pool.query('DROP TRIGGER reject_booking_decision ON audit_event')
      await pool.query('DROP FUNCTION reject_booking_decision()')
    }
  })

  it('reflects rescheduling and cancellation for the linked parent without leaking other families', async () => {
    const item = (await listBookingRequests(doctor)).find(row => row.time === '09:30' && row.childName === input.childName)!
    const approved = await decideBookingRequest(doctor, item.id, 'APPROVE')
    expect(approved.status).toBe('APPROVED')
    const appointmentId = approved.appointmentId!
    await rescheduleAppointment(assistant, appointmentId, { date: '2027-03-15', time: '09:30' })
    expect((await listParentAppointments(parent))[0]).toMatchObject({ status: 'RESCHEDULED', date: '2027-03-15' })
    await cancelAppointment(doctor, appointmentId)
    expect((await listParentAppointments(parent))[0]?.status).toBe('CANCELLED')
    expect((await listParentAppointments(stranger))).toEqual([])
    expect((await db.select().from(bookingNotice)).map(row => row.status)).toEqual(expect.arrayContaining(['RESCHEDULED', 'CANCELLED']))
  })

  it('does not approve a parent request while a concurrent revocation is uncommitted', async () => {
    const request = await submitParentBooking(parent, { patientId: child, date: '2027-04-05', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
    const blocker = await pool.connect()
    await blocker.query('BEGIN')
    let released = false
    try {
      await blocker.query('UPDATE guardian_grant SET status = $1 WHERE patient_id = $2 AND guardian_id = $3', ['REVOKED', child, parent.id])
      let settled = false
      const approval = decideBookingRequest(doctor, request.id, 'APPROVE').then((value) => {
        settled = true
        return value
      }, (error: unknown) => {
        settled = true
        throw error
      })
      const outcome = approval.then(value => ({ value }), (error: unknown) => ({ error }))
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(settled).toBe(false)
      await blocker.query('COMMIT')
      released = true
      const result = await outcome
      expect(result).toMatchObject({ error: { statusCode: 409 } })
      expect((await db.select().from(bookingRequest).where(eq(bookingRequest.id, request.id)))[0]?.status).toBe('PENDING')
      expect((await db.select().from(appointment).where(eq(appointment.startsAt, new Date('2027-04-05T14:00:00Z'))))).toEqual([])
    } finally {
      if (!released) await blocker.query('ROLLBACK')
      blocker.release()
      await pool.query('UPDATE guardian_grant SET status = $1 WHERE patient_id = $2 AND guardian_id = $3', ['ACTIVE', child, parent.id])
    }
  })

  it('waits for an in-flight guardian revocation before accepting a parent submission', async () => {
    const blocker = await pool.connect()
    await blocker.query('BEGIN')
    let released = false
    try {
      await blocker.query('UPDATE guardian_grant SET status = $1 WHERE patient_id = $2 AND guardian_id = $3', ['REVOKED', child, parent.id])
      let settled = false
      const outcome = submitParentBooking(parent, { patientId: child, date: '2027-05-03', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' }).then((value) => {
        settled = true
        return { value }
      }, (error: unknown) => {
        settled = true
        return { error }
      })
      await new Promise(resolve => setTimeout(resolve, 100))
      const completedBeforeRevoke = settled
      await blocker.query('COMMIT')
      released = true
      expect(completedBeforeRevoke).toBe(false)
      expect(await outcome).toMatchObject({ error: { statusCode: 404 } })
      expect((await db.select().from(bookingRequest).where(eq(bookingRequest.patientId, child))).some(row => row.startsAt.getTime() === new Date('2027-05-03T14:00:00Z').getTime())).toBe(false)
    } finally {
      if (!released) await blocker.query('ROLLBACK')
      blocker.release()
      await pool.query('UPDATE guardian_grant SET status = $1 WHERE patient_id = $2 AND guardian_id = $3', ['ACTIVE', child, parent.id])
    }
  })

  it('lets staff decline a revoked guardian request so the queue clears and a later request is possible', async () => {
    const standaloneChild = randomUUID()
    await pool.query('INSERT INTO patient (id, name, birth_date, sex, created_by) VALUES ($1,$2,$3,$4,$5)', [standaloneChild, 'Paciente de prueba', input.birthDate, input.sex, doctor.id])
    await pool.query('INSERT INTO guardian_grant (patient_id, guardian_id, contact_email, proof, verified_by, status) VALUES ($1,$2,$3,$4,$5,$6)', [standaloneChild, parent.id, `${parent.id}@example.test`, 'Identidad verificada presencialmente', doctor.id, 'ACTIVE'])
    const request = await submitParentBooking(parent, { patientId: standaloneChild, date: '2027-05-10', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
    await pool.query('UPDATE guardian_grant SET status = $1 WHERE patient_id = $2 AND guardian_id = $3', ['REVOKED', standaloneChild, parent.id])
    try {
      await expect(decideBookingRequest(doctor, request.id, 'APPROVE')).rejects.toMatchObject({ statusCode: 409 })
      expect(await decideBookingRequest(assistant, request.id, 'DECLINE')).toEqual({ requestId: request.id, status: 'DECLINED' })
      expect((await listBookingRequests(assistant)).some(row => row.id === request.id)).toBe(false)
      expect((await db.select().from(bookingNotice)).some(row => row.requestId === request.id && row.status === 'DECLINED')).toBe(true)
    } finally {
      await pool.query('UPDATE guardian_grant SET status = $1 WHERE patient_id = $2 AND guardian_id = $3', ['ACTIVE', standaloneChild, parent.id])
    }
    const later = await submitParentBooking(parent, { patientId: standaloneChild, date: '2027-05-17', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
    expect(later.status).toBe('PENDING')
  })

  it('shows one confirmed child appointment to both active guardians even after requester revocation', async () => {
    const first: Actor = { id: randomUUID(), roles: ['PATIENT'] }
    const second: Actor = { id: randomUUID(), roles: ['PATIENT'] }
    const sibling = randomUUID()
    await pool.query('INSERT INTO patient (id, name, birth_date, sex, created_by) VALUES ($1,$2,$3,$4,$5)', [sibling, 'Hermana de prueba', input.birthDate, input.sex, doctor.id])
    for (const actor of [first, second]) {
      await pool.query('INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)', [actor.id, 'Representante de prueba', `${actor.id}@example.test`])
      await pool.query('INSERT INTO guardian_grant (patient_id, guardian_id, contact_email, proof, verified_by, status) VALUES ($1,$2,$3,$4,$5,$6)', [sibling, actor.id, `${actor.id}@example.test`, 'Identidad verificada presencialmente', doctor.id, 'ACTIVE'])
    }
    const request = await submitParentBooking(first, { patientId: sibling, date: '2027-05-24', time: '09:00', consent: true, consentVersion: 'DRAFT-2026-11' })
    expect((await listParentAppointments(first)).filter(row => row.id === request.id)).toHaveLength(1)
    expect((await listParentAppointments(second)).some(row => row.id === request.id)).toBe(false)
    await decideBookingRequest(doctor, request.id, 'APPROVE')
    expect((await listParentAppointments(first)).filter(row => row.id === request.id)).toHaveLength(1)
    expect((await listParentAppointments(second)).filter(row => row.id === request.id)).toHaveLength(1)
    await pool.query('UPDATE guardian_grant SET status = $1 WHERE patient_id = $2 AND guardian_id = $3', ['REVOKED', sibling, first.id])
    expect((await listParentAppointments(first)).some(row => row.id === request.id)).toBe(false)
    expect((await listParentAppointments(second)).filter(row => row.id === request.id)).toHaveLength(1)
  })

  it('rejects the same verified child and slot despite name case and whitespace changes', async () => {
    const address = `case-${randomUUID()}@example.test`
    let code = ''
    await issueBookingCode(address, '127.18.0.1', async (_, value) => {
      code = value
    })
    const proof = await verifyBookingContact(address, code, '127.18.0.2')
    const first = await submitBookingRequest({ ...input, date: '2027-04-12', childName: 'Alma  Prueba', email: address, verificationToken: proof })
    let secondCode = ''
    await issueBookingCode(address, '127.18.0.3', async (_, value) => {
      secondCode = value
    })
    const secondProof = await verifyBookingContact(address, secondCode, '127.18.0.4')
    await expect(submitBookingRequest({ ...input, date: '2027-04-12', childName: 'alma prueba', email: address.toUpperCase(), verificationToken: secondProof })).rejects.toMatchObject({ statusCode: 409 })
    expect((await db.select().from(bookingRequest).where(eq(bookingRequest.email, address))).map(row => row.id)).toEqual([first.id])
  })
})
