import { randomUUID } from 'node:crypto'
import { and, eq, gte, lte, sql } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import type { Actor } from '../../shared/types/access'
import { appointmentMoveSchema, appointmentSchema, assistantAppointmentSchema, dateRangeSchema, type Appointment, type AppointmentInput, type DateRange } from '../../shared/types/scheduling'
import { appointment, auditEvent, patient, visit } from '../db/schema'
import { useDb } from '../utils/db'
import { availableSlots, instant, localDate, localTime, requireSchedule, zone } from './availability'

type Row = typeof appointment.$inferSelect
const audit = (action: string, actor: Actor, subjectId: string) => ({ id: randomUUID(), action, actorId: actor.id, subjectId, outcome: 'ALLOWED' })
function projection(row: Row, actor: Actor, details?: { birthDate: string, weightKg: string | null }): Appointment {
  const basic: Appointment = { id: row.id, date: localDate(row.startsAt), time: localTime(row.startsAt), name: row.name, contact: row.contact, status: row.status }
  if (!actor.roles.includes('DOCTOR')) return basic
  return { ...basic, reason: row.reason, ...(row.patientId ? { patientId: row.patientId } : {}), ...(details ? { birthDate: details.birthDate, ...(details.weightKg !== null ? { lastWeightKg: Number(details.weightKg) } : {}) } : {}) }
}

async function project(row: Row, actor: Actor): Promise<Appointment> {
  if (!actor.roles.includes('DOCTOR') || !row.patientId) return projection(row, actor)
  const db = useDb()
  const [person] = await db.select({ birthDate: patient.birthDate }).from(patient).where(eq(patient.id, row.patientId))
  const [last] = await db.select({ weightKg: visit.weightKg }).from(visit).where(eq(visit.patientId, row.patientId)).orderBy(sql`${visit.measuredAt} DESC`).limit(1)
  return projection(row, actor, person ? { birthDate: person.birthDate, weightKg: last?.weightKg ?? null } : undefined)
}

async function reserve(tx: Parameters<Parameters<ReturnType<typeof useDb>['transaction']>[0]>[0], date: string, time: string, existingId?: string): Promise<{ startsAt: Date, endsAt: Date }> {
  const slots = await availableSlots({ from: date, to: date }, existingId, tx)
  const slot = slots.find(item => item.time === time && item.free)
  if (!slot || instant(date, time) < new Date()) throw createError({ statusCode: 409, statusMessage: 'Horario no disponible' })
  return { startsAt: instant(date, time), endsAt: new Date(instant(date, time).getTime() + slot.durationMinutes * 60000) }
}

export async function scheduleAppointment(actor: Actor, input: AppointmentInput): Promise<Appointment> {
  await requireSchedule(actor)
  const doctor = actor.roles.includes('DOCTOR')
  if (!doctor && ('patientId' in input || 'reason' in input)) throw createError({ statusCode: 403, statusMessage: 'Access denied' })
  const values = doctor ? appointmentSchema.parse(input) : assistantAppointmentSchema.parse(input)
  const db = useDb()
  const row = await db.transaction(async (tx) => {
    await tx.execute('SELECT pg_advisory_xact_lock(1130011)')
    const patientId = 'patientId' in values && typeof values.patientId === 'string' ? values.patientId : undefined
    if (patientId && !(await tx.select({ id: patient.id }).from(patient).where(eq(patient.id, patientId)))[0]) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
    const interval = await reserve(tx, values.date, values.time)
    const [inserted] = await tx.insert(appointment).values({ id: randomUUID(), ...interval, patientId, name: values.name, contact: values.contact, reason: 'reason' in values && typeof values.reason === 'string' ? values.reason : '', timeZone: zone, status: values.status, createdBy: actor.id }).returning()
    await tx.insert(auditEvent).values(audit('APPOINTMENT_CREATE', actor, inserted!.id))
    return inserted!
  })
  return project(row, actor)
}

export async function listAppointments(actor: Actor, range: DateRange): Promise<Appointment[]> {
  await requireSchedule(actor)
  const values = dateRangeSchema.parse(range)
  const rows = await useDb().select().from(appointment).where(and(gte(appointment.startsAt, instant(values.from, '00:00')), lte(appointment.startsAt, instant(values.to, '23:59')))).orderBy(appointment.startsAt)
  return Promise.all(rows.map(row => project(row, actor)))
}

export async function getAppointment(actor: Actor, id: string): Promise<Appointment> {
  await requireSchedule(actor)
  const [row] = await useDb().select().from(appointment).where(eq(appointment.id, id))
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Cita no encontrada' })
  return project(row, actor)
}

export async function rescheduleAppointment(actor: Actor, id: string, input: { date: string, time: string }): Promise<Appointment> {
  await requireSchedule(actor)
  const values = appointmentMoveSchema.parse(input)
  const row = await useDb().transaction(async (tx) => {
    await tx.execute('SELECT pg_advisory_xact_lock(1130011)')
    const [current] = await tx.select().from(appointment).where(eq(appointment.id, id))
    if (!current) throw createError({ statusCode: 404, statusMessage: 'Cita no encontrada' })
    if (current.status === 'CANCELLED' || current.status === 'ATTENDED') throw createError({ statusCode: 409, statusMessage: 'Cita cerrada' })
    const interval = await reserve(tx, values.date, values.time, id)
    const [updated] = await tx.update(appointment).set(interval).where(eq(appointment.id, id)).returning()
    await tx.insert(auditEvent).values(audit('APPOINTMENT_RESCHEDULE', actor, id))
    return updated!
  })
  return project(row, actor)
}

export async function cancelAppointment(actor: Actor, id: string): Promise<Appointment> {
  await requireSchedule(actor)
  const row = await useDb().transaction(async (tx) => {
    await tx.execute('SELECT pg_advisory_xact_lock(1130011)')
    const [current] = await tx.select().from(appointment).where(eq(appointment.id, id))
    if (!current) throw createError({ statusCode: 404, statusMessage: 'Cita no encontrada' })
    if (current.status === 'CANCELLED' || current.status === 'ATTENDED') throw createError({ statusCode: 409, statusMessage: 'Cita cerrada' })
    const [updated] = await tx.update(appointment).set({ status: 'CANCELLED' }).where(eq(appointment.id, id)).returning()
    await tx.insert(auditEvent).values(audit('APPOINTMENT_CANCEL', actor, id))
    return updated!
  })
  return project(row, actor)
}

export async function confirmAppointment(actor: Actor, id: string): Promise<Appointment> {
  await requireSchedule(actor)
  const row = await useDb().transaction(async (tx) => {
    await tx.execute('SELECT pg_advisory_xact_lock(1130011)')
    const [current] = await tx.select().from(appointment).where(eq(appointment.id, id))
    if (!current || current.status !== 'PENDING') throw createError({ statusCode: 409, statusMessage: 'Cita no disponible' })
    const [updated] = await tx.update(appointment).set({ status: 'CONFIRMED' }).where(eq(appointment.id, id)).returning()
    await tx.insert(auditEvent).values(audit('APPOINTMENT_CONFIRM', actor, id))
    return updated!
  })
  return project(row, actor)
}

export async function attendAppointment(actor: Actor, id: string): Promise<Appointment> {
  await requireSchedule(actor)
  const row = await useDb().transaction(async (tx) => {
    await tx.execute('SELECT pg_advisory_xact_lock(1130011)')
    const [current] = await tx.select().from(appointment).where(eq(appointment.id, id))
    if (!current || current.status !== 'CONFIRMED') throw createError({ statusCode: 409, statusMessage: 'Cita no disponible' })
    const [updated] = await tx.update(appointment).set({ status: 'ATTENDED' }).where(eq(appointment.id, id)).returning()
    await tx.insert(auditEvent).values(audit('APPOINTMENT_ATTEND', actor, id))
    return updated!
  })
  return project(row, actor)
}
