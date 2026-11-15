import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
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

  it('reserves atomically and never exposes clinical identity or links to assistant', async () => {
    await saveAvailability(doctor, { days: [{ weekday: 1, open: '09:00', close: '11:00' }], durationMinutes: 30, blocked: [] })
    const results = await Promise.allSettled([scheduleAppointment(doctor, input), scheduleAppointment(assistant, { ...input, name: 'Otra persona' })])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const [item] = await listAppointments(assistant, { from: date, to: date })
    expect(Object.keys(item!).sort()).toEqual(['contact', 'date', 'id', 'name', 'status', 'time'])
    const doctorItem = (await listAppointments(doctor, { from: date, to: date }))[0]!
    expect(doctorItem.reason).toBe('Control')
    await expect(listAppointments(adminOnly, { from: date, to: date })).rejects.toMatchObject({ statusCode: 403 })
    expect((await getAvailability(assistant, { from: date, to: date })).find(slot => slot.time === '09:00')?.free).toBe(false)
    await expect(scheduleAppointment(assistant, { ...input, name: 'Solapa', time: '09:15' })).rejects.toMatchObject({ statusCode: 409 })
    await saveAvailability(doctor, { days: [{ weekday: 1, open: '09:00', close: '11:00' }], durationMinutes: 60, blocked: [] })
    expect((await getAvailability(doctor, { from: date, to: date })).find(slot => slot.time === '09:00')?.free).toBe(false)
    expect((await getAvailability(doctor, { from: date, to: date })).find(slot => slot.time === '10:00')?.free).toBe(true)
    await saveAvailability(doctor, { days: [{ weekday: 1, open: '09:00', close: '11:00' }], durationMinutes: 30, blocked: [] })
  })

  it('audits reschedule and cancellation while restoring old capacity', async () => {
    const current = (await listAppointments(doctor, { from: date, to: date }))[0]!
    const moved = await rescheduleAppointment(assistant, current.id, { date, time: '10:00' })
    expect(moved.time).toBe('10:00')
    expect((await getAvailability(doctor, { from: date, to: date })).find(slot => slot.time === '09:00')?.free).toBe(true)
    expect((await cancelAppointment(doctor, current.id)).status).toBe('CANCELLED')
    expect((await getAppointment(assistant, current.id)).status).toBe('CANCELLED')
    expect((await getAvailability(doctor, { from: date, to: date })).find(slot => slot.time === '10:00')?.free).toBe(true)
    await expect(scheduleAppointment(assistant, { ...input, name: 'Sin expediente', patientId: randomUUID(), time: '10:00' })).rejects.toMatchObject({ statusCode: 404 })
    const { useDb } = await import('../../server/utils/db')
    const { auditEvent } = await import('../../server/db/schema')
    const { eq } = await import('drizzle-orm')
    expect((await useDb().select().from(auditEvent).where(eq(auditEvent.subjectId, current.id))).map(row => row.action)).toEqual(expect.arrayContaining(['APPOINTMENT_RESCHEDULE', 'APPOINTMENT_CANCEL']))
  })
})
