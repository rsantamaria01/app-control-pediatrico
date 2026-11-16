import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { eq } from 'drizzle-orm'
import { appointment, auditEvent } from '../../server/db/schema'
import type { Actor } from '../../shared/types/access'
import { getAvailability, saveAvailability } from '../../server/services/availability'
import { cancelAppointment, getAppointment, listAppointments, rescheduleAppointment, scheduleAppointment } from '../../server/services/appointments'

const configured = process.env.WHO_TEST_DATABASE_URL
if (!configured || !['/pediatrico_who_slice3_test', '/pediatrico_who_slice3_verify', '/pediatrico_who_slice3_guard', '/pediatrico_who_slice3_sealed_test'].includes(new URL(configured).pathname) || configured === process.env.DATABASE_URL) throw new Error('Dedicated WHO test database required')
const name = `pediatrico_agenda_${randomUUID().replace(/-/g, '')}`
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
const adminOnly: Actor = { id: randomUUID(), roles: ['ADMIN'] }
let created = false

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${name}"`)
  created = true
  process.env.DATABASE_URL = target.href
  await migrate(drizzle(pool), { migrationsFolder: './server/db/migrations' })
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

const date = '2026-12-07'
const input = { date, time: '09:00', name: 'Paciente Agenda', contact: '0998765432', reason: 'Control', status: 'CONFIRMED' as const }

describe('agenda on disposable database', () => {
  it('respects opening hours, blocked days and changing duration', async () => {
    await expect(getAvailability(adminOnly, { from: date, to: date })).rejects.toMatchObject({ statusCode: 403 })
    await saveAvailability(assistant, { days: [{ weekday: 1, open: '09:00', close: '10:00' }], durationMinutes: 30, blocked: [] })
    expect((await getAvailability(doctor, { from: date, to: date })).map(slot => slot.time)).toEqual(['09:00', '09:30'])
    await saveAvailability(assistant, { days: [{ weekday: 1, open: '09:00', close: '10:00' }], durationMinutes: 45, blocked: [] })
    expect((await getAvailability(doctor, { from: date, to: date })).map(slot => slot.time)).toEqual(['09:00'])
    await saveAvailability(assistant, { days: [{ weekday: 1, open: '09:00', close: '10:00' }], durationMinutes: 30, blocked: [{ date, from: '09:30', to: '10:00' }] })
    expect((await getAvailability(doctor, { from: date, to: date })).filter(slot => slot.free).map(slot => slot.time)).toEqual(['09:00'])
    await expect(saveAvailability(assistant, { days: [{ weekday: 1, open: '10:00', close: '09:00' }], durationMinutes: 30, blocked: [] })).rejects.toThrow()
    await expect(getAvailability(doctor, { from: '2026-12-31', to: '2026-12-01' })).rejects.toThrow()
    await saveAvailability(assistant, { days: [{ weekday: 1, open: '09:00', close: '10:00' }], durationMinutes: 30, blocked: [{ date, from: '00:00', to: '23:59' }] })
    expect((await getAvailability(doctor, { from: date, to: date })).every(slot => !slot.free)).toBe(true)
  })

  it('rolls back availability changes when audit storage fails', async () => {
    const baseline = { days: [{ weekday: 1, open: '09:00', close: '10:00' }], durationMinutes: 30, blocked: [] }
    await saveAvailability(doctor, baseline)
    await pool.query(`CREATE FUNCTION reject_hours_audit() RETURNS trigger AS $$ BEGIN IF NEW.action = 'AVAILABILITY_UPDATE' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`)
    await pool.query('CREATE TRIGGER reject_hours_audit BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION reject_hours_audit()')
    try {
      await expect(saveAvailability(assistant, { days: [{ weekday: 1, open: '12:00', close: '14:00' }], durationMinutes: 60, blocked: [{ date, from: '12:00', to: '13:00' }] })).rejects.toThrow()
      expect((await getAvailability(doctor, { from: date, to: date })).map(slot => slot.time)).toEqual(['09:00', '09:30'])
      const { getAvailabilitySettings } = await import('../../server/services/availability')
      expect(await getAvailabilitySettings(doctor)).toEqual(baseline)
    } finally {
      await pool.query('DROP TRIGGER reject_hours_audit ON audit_event')
      await pool.query('DROP FUNCTION reject_hours_audit()')
    }
  })

  it('reserves atomically and never exposes clinical identity or links to assistant', async () => {
    await saveAvailability(doctor, { days: [{ weekday: 1, open: '09:00', close: '11:00' }], durationMinutes: 30, blocked: [] })
    const results = await Promise.allSettled([scheduleAppointment(doctor, input), scheduleAppointment(assistant, { date, time: '09:00', name: 'Otra persona', contact: input.contact })])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const [item] = await listAppointments(assistant, { from: date, to: date })
    expect(Object.keys(item!).sort()).toEqual(['contact', 'date', 'id', 'name', 'status', 'time'])
    const doctorItem = (await listAppointments(doctor, { from: date, to: date }))[0]!
    expect(doctorItem.reason).toBe('Control')
    await expect(listAppointments(adminOnly, { from: date, to: date })).rejects.toMatchObject({ statusCode: 403 })
    expect((await getAvailability(assistant, { from: date, to: date })).find(slot => slot.time === '09:00')?.free).toBe(false)
    await expect(scheduleAppointment(assistant, { date, name: 'Solapa', contact: input.contact, time: '09:15' })).rejects.toMatchObject({ statusCode: 409 })
    await saveAvailability(doctor, { days: [{ weekday: 1, open: '09:00', close: '11:00' }], durationMinutes: 60, blocked: [] })
    expect((await getAvailability(doctor, { from: date, to: date })).find(slot => slot.time === '09:00')?.free).toBe(false)
    expect((await getAvailability(doctor, { from: date, to: date })).find(slot => slot.time === '10:00')?.free).toBe(true)
    await saveAvailability(doctor, { days: [{ weekday: 1, open: '09:00', close: '11:00' }], durationMinutes: 30, blocked: [] })
  })

  it('rejects assistant patient links and reasons without persisting clinical data', async () => {
    await saveAvailability(doctor, { days: [{ weekday: 1, open: '09:00', close: '11:00' }], durationMinutes: 30, blocked: [] })
    const patientId = randomUUID()
    await pool.query('INSERT INTO patient (id, name, birth_date, sex, created_by) VALUES ($1,$2,$3,$4,$5)', [patientId, 'Niña protegida', '2024-01-01', 'FEMALE', doctor.id])
    await expect(scheduleAppointment(assistant, { ...input, time: '09:30', patientId })).rejects.toMatchObject({ statusCode: 403 })
    await expect(scheduleAppointment(assistant, { ...input, time: '09:30' })).rejects.toMatchObject({ statusCode: 403 })
    await expect(scheduleAppointment(assistant, { date, time: '09:30', name: 'Inyección', contact: input.contact, patientId })).rejects.toMatchObject({ statusCode: 403 })
    await expect(scheduleAppointment(assistant, { date, time: '09:30', name: 'Inyección', contact: input.contact, reason: 'Confidencial' })).rejects.toMatchObject({ statusCode: 403 })
    const created = await scheduleAppointment(assistant, { date, time: '09:30', name: 'Sin datos clínicos', contact: '0998765432' })
    const [stored] = await pool.query('SELECT patient_id, reason FROM appointment WHERE id = $1', [created.id]).then(result => result.rows)
    expect(stored).toEqual({ patient_id: null, reason: '' })
    expect(await getAppointment(assistant, created.id)).toEqual({ id: created.id, date, time: '09:30', name: 'Sin datos clínicos', contact: '0998765432', status: 'CONFIRMED' })
    await expect(scheduleAppointment(doctor, { date, time: '10:00', name: 'Doctor sin motivo', contact: '0998765432' })).rejects.toThrow()
  })

  it('books and reschedules with a saturated one-connection pool without waiting for another connection', async () => {
    const { useDb } = await import('../../server/utils/db')
    const dbPool = useDb().$client
    const priorMax = dbPool.options.max
    dbPool.options.max = 1
    const bookingDate = '2027-01-11'
    try {
      await saveAvailability(doctor, { days: [{ weekday: 1, open: '09:00', close: '11:00' }], durationMinutes: 30, blocked: [] })
      const booked = await Promise.race([
        scheduleAppointment(doctor, { ...input, date: bookingDate, time: '09:00' }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('booking needs a second pool connection')), 1500))
      ])
      const moved = await Promise.race([
        rescheduleAppointment(doctor, booked.id, { date: bookingDate, time: '09:30' }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('rescheduling needs a second pool connection')), 1500))
      ])
      expect(moved.time).toBe('09:30')
    } finally {
      dbPool.options.max = priorMax
    }
  })

  it('rolls back a new appointment when its audit insert fails', async () => {
    await saveAvailability(doctor, { days: [{ weekday: 1, open: '09:00', close: '11:00' }], durationMinutes: 30, blocked: [] })
    await pool.query(`CREATE FUNCTION reject_appointment_audit() RETURNS trigger AS $$ BEGIN IF NEW.action = 'APPOINTMENT_CREATE' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`)
    await pool.query('CREATE TRIGGER reject_appointment_audit BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION reject_appointment_audit()')
    try {
      await expect(scheduleAppointment(doctor, { ...input, time: '10:30' })).rejects.toThrow()
      expect((await db.select({ id: appointment.id }).from(appointment).where(eq(appointment.startsAt, new Date('2026-12-07T15:30:00Z'))))).toEqual([])
    } finally {
      await pool.query('DROP TRIGGER reject_appointment_audit ON audit_event')
      await pool.query('DROP FUNCTION reject_appointment_audit()')
    }
  })

  it('does not reprogram or cancel a committed appointment if its audit cannot be stored', async () => {
    await saveAvailability(doctor, { days: [{ weekday: 1, open: '09:00', close: '11:00' }], durationMinutes: 30, blocked: [] })
    const created = await scheduleAppointment(doctor, { ...input, date: '2026-12-14', time: '10:00' })
    await pool.query(`CREATE FUNCTION reject_appointment_changes() RETURNS trigger AS $$ BEGIN IF NEW.action IN ('APPOINTMENT_RESCHEDULE','APPOINTMENT_CANCEL') THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`)
    await pool.query('CREATE TRIGGER reject_appointment_changes BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION reject_appointment_changes()')
    try {
      await expect(rescheduleAppointment(doctor, created.id, { date: '2026-12-14', time: '10:30' })).rejects.toThrow()
      expect((await getAppointment(doctor, created.id)).time).toBe('10:00')
      await expect(cancelAppointment(doctor, created.id)).rejects.toThrow()
      expect((await getAppointment(doctor, created.id)).status).toBe('CONFIRMED')
    } finally {
      await pool.query('DROP TRIGGER reject_appointment_changes ON audit_event')
      await pool.query('DROP FUNCTION reject_appointment_changes()')
    }
  })

  it('confirms a pending appointment once and records only committed transitions', async () => {
    const { confirmAppointment, attendAppointment } = await import('../../server/services/appointments')
    await saveAvailability(doctor, { days: [{ weekday: 1, open: '09:00', close: '11:00' }], durationMinutes: 30, blocked: [] })
    const pending = await scheduleAppointment(assistant, { date: '2027-01-18', time: '09:00', name: 'Pendiente', contact: input.contact, status: 'PENDING' })
    const results = await Promise.allSettled([confirmAppointment(doctor, pending.id), confirmAppointment(assistant, pending.id)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect((await getAppointment(assistant, pending.id)).status).toBe('CONFIRMED')
    await expect(confirmAppointment(doctor, pending.id)).rejects.toMatchObject({ statusCode: 409 })
    expect((await db.select().from(auditEvent).where(eq(auditEvent.subjectId, pending.id))).filter(row => row.action === 'APPOINTMENT_CONFIRM')).toHaveLength(1)
    expect((await attendAppointment(assistant, pending.id)).status).toBe('ATTENDED')
    await expect(confirmAppointment(doctor, pending.id)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('cannot confirm an appointment when its audit fails', async () => {
    const { confirmAppointment } = await import('../../server/services/appointments')
    await saveAvailability(doctor, { days: [{ weekday: 1, open: '09:00', close: '11:00' }], durationMinutes: 30, blocked: [] })
    const pending = await scheduleAppointment(assistant, { date: '2027-01-25', time: '09:00', name: 'Pendiente auditable', contact: input.contact, status: 'PENDING' })
    await pool.query(`CREATE FUNCTION reject_confirmation_audit() RETURNS trigger AS $$ BEGIN IF NEW.action = 'APPOINTMENT_CONFIRM' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`)
    await pool.query('CREATE TRIGGER reject_confirmation_audit BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION reject_confirmation_audit()')
    try {
      await expect(confirmAppointment(doctor, pending.id)).rejects.toThrow()
      expect((await getAppointment(doctor, pending.id)).status).toBe('PENDING')
    } finally {
      await pool.query('DROP TRIGGER reject_confirmation_audit ON audit_event')
      await pool.query('DROP FUNCTION reject_confirmation_audit()')
    }
    await cancelAppointment(assistant, pending.id)
    await expect(confirmAppointment(doctor, pending.id)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('does not attend a pending appointment before staff confirms it', async () => {
    const { attendAppointment, confirmAppointment } = await import('../../server/services/appointments')
    await saveAvailability(doctor, { days: [{ weekday: 1, open: '09:00', close: '11:00' }], durationMinutes: 30, blocked: [] })
    const pending = await scheduleAppointment(assistant, { date: '2027-02-01', time: '09:00', name: 'Por confirmar', contact: input.contact, status: 'PENDING' })
    await expect(attendAppointment(assistant, pending.id)).rejects.toMatchObject({ statusCode: 409 })
    expect((await getAppointment(doctor, pending.id)).status).toBe('PENDING')
    await confirmAppointment(assistant, pending.id)
    expect((await attendAppointment(doctor, pending.id)).status).toBe('ATTENDED')
  })

  it('rolls back attendance on an audit failure and never attends a cancelled appointment', async () => {
    const { attendAppointment } = await import('../../server/services/appointments')
    await saveAvailability(doctor, { days: [{ weekday: 1, open: '09:00', close: '11:00' }], durationMinutes: 30, blocked: [] })
    const created = await scheduleAppointment(doctor, { ...input, date: '2026-12-21', time: '10:00' })
    await pool.query(`CREATE FUNCTION reject_attendance_audit() RETURNS trigger AS $$ BEGIN IF NEW.action = 'APPOINTMENT_ATTEND' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`)
    await pool.query('CREATE TRIGGER reject_attendance_audit BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION reject_attendance_audit()')
    try {
      await expect(attendAppointment(doctor, created.id)).rejects.toThrow()
      expect((await getAppointment(doctor, created.id)).status).toBe('CONFIRMED')
    } finally {
      await pool.query('DROP TRIGGER reject_attendance_audit ON audit_event')
      await pool.query('DROP FUNCTION reject_attendance_audit()')
    }
    await cancelAppointment(doctor, created.id)
    await expect(attendAppointment(doctor, created.id)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('attendance waits for the scheduling lock and rechecks the cancelled state', async () => {
    const { attendAppointment } = await import('../../server/services/appointments')
    await saveAvailability(doctor, { days: [{ weekday: 1, open: '09:00', close: '11:00' }], durationMinutes: 30, blocked: [] })
    const current = await scheduleAppointment(doctor, { ...input, date: '2026-12-28', time: '10:00' })
    const blocker = await pool.connect()
    await blocker.query('BEGIN')
    await blocker.query('SELECT pg_advisory_xact_lock(1130011)')
    let settled = false
    const pending = attendAppointment(doctor, current.id).finally(() => {
      settled = true
    }).catch(() => undefined)
    try {
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(settled).toBe(false)
      const waiting = await pool.query('SELECT wait_event_type, wait_event FROM pg_stat_activity WHERE wait_event_type = $1 AND query LIKE $2', ['Lock', '%pg_advisory_xact_lock(1130011)%'])
      expect(waiting.rows.length).toBeGreaterThan(0)
      await blocker.query('UPDATE appointment SET status = $1 WHERE id = $2', ['CANCELLED', current.id])
      await blocker.query('COMMIT')
      await pending
      expect((await getAppointment(doctor, current.id)).status).toBe('CANCELLED')
      expect((await db.select().from(auditEvent).where(eq(auditEvent.subjectId, current.id))).map(row => row.action)).not.toContain('APPOINTMENT_ATTEND')
    } finally {
      await blocker.query('ROLLBACK')
      blocker.release()
    }
  })

  it('serializes attendance against cancellation and rescheduling without resurrecting a closed appointment', async () => {
    const { attendAppointment } = await import('../../server/services/appointments')
    await saveAvailability(doctor, { days: [{ weekday: 1, open: '09:00', close: '11:00' }], durationMinutes: 30, blocked: [] })
    const current = await scheduleAppointment(doctor, { ...input, date: '2027-01-04', time: '10:00' })
    const outcomes = await Promise.allSettled([attendAppointment(doctor, current.id), cancelAppointment(assistant, current.id)])
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    const final = await getAppointment(doctor, current.id)
    expect(['CANCELLED', 'ATTENDED']).toContain(final.status)
    expect(outcomes.find(outcome => outcome.status === 'fulfilled')).toMatchObject({ value: { status: final.status } })
    await expect(rescheduleAppointment(doctor, current.id, { date: '2027-01-04', time: '10:30' })).rejects.toMatchObject({ statusCode: 409 })
    const second = await scheduleAppointment(doctor, { ...input, date: '2027-01-04', time: '10:30' })
    const competing = await Promise.allSettled([attendAppointment(doctor, second.id), rescheduleAppointment(assistant, second.id, { date: '2027-01-04', time: '09:30' })])
    const end = await getAppointment(doctor, second.id)
    expect(competing.some(outcome => outcome.status === 'fulfilled')).toBe(true)
    if (end.status === 'ATTENDED') await expect(rescheduleAppointment(assistant, second.id, { date: '2027-01-04', time: '09:00' })).rejects.toMatchObject({ statusCode: 409 })
    expect((await db.select().from(auditEvent).where(eq(auditEvent.subjectId, second.id))).map(row => row.action)).toContain('APPOINTMENT_ATTEND')
  })

  it('audits reschedule and cancellation while restoring old capacity', async () => {
    const current = (await listAppointments(doctor, { from: date, to: date }))[0]!
    const moved = await rescheduleAppointment(assistant, current.id, { date, time: '09:00' })
    expect(moved.time).toBe('09:00')
    expect((await getAvailability(doctor, { from: date, to: date })).find(slot => slot.time === '09:00')?.free).toBe(false)
    expect((await cancelAppointment(doctor, current.id)).status).toBe('CANCELLED')
    expect((await getAppointment(assistant, current.id)).status).toBe('CANCELLED')
    expect((await getAvailability(doctor, { from: date, to: date })).find(slot => slot.time === '10:00')?.free).toBe(true)
    await expect(scheduleAppointment(doctor, { ...input, name: 'Sin expediente', patientId: randomUUID(), time: '10:00' })).rejects.toMatchObject({ statusCode: 404 })
    expect((await db.select().from(auditEvent).where(eq(auditEvent.subjectId, current.id))).map(row => row.action)).toEqual(expect.arrayContaining(['APPOINTMENT_RESCHEDULE', 'APPOINTMENT_CANCEL']))
  })
})
