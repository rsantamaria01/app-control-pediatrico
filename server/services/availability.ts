import { randomUUID } from 'node:crypto'
import { gte, lte, and, ne } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import type { Actor } from '../../shared/types/access'
import { availabilitySchema, dateRangeSchema, type AvailabilityInput, type DateRange, type Slot } from '../../shared/types/scheduling'
import { appointment, blockedHour, clinicSchedule, openingHour } from '../db/schema'
import { useDb } from '../utils/db'
import { recordAudit } from './audit'

export const zone = 'America/Guayaquil'
export const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
export const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
export const instant = (date: string, time: string) => new Date(`${date}T${time}:00-05:00`)
export const localDate = (value: Date) => new Date(value.getTime() - 5 * 3600000).toISOString().slice(0, 10)
export const localTime = (value: Date) => new Date(value.getTime() - 5 * 3600000).toISOString().slice(11, 16)

export async function requireSchedule(actor: Actor) {
  if (actor.roles.includes('DOCTOR') || actor.roles.includes('ASSISTANT')) return
  await recordAudit('SCHEDULE', 'DENIED', actor.id)
  throw createError({ statusCode: 403, statusMessage: 'Access denied' })
}

export async function getAvailabilitySettings(actor: Actor): Promise<AvailabilityInput> {
  await requireSchedule(actor)
  const db = useDb()
  const [settings, days, blocked] = await Promise.all([db.select().from(clinicSchedule), db.select().from(openingHour), db.select().from(blockedHour)])
  return { durationMinutes: settings[0]?.durationMinutes ?? 30, days: days.map(row => ({ weekday: row.weekday, open: row.open, close: row.close })), blocked: blocked.map(row => ({ date: row.date, from: row.from, to: row.to })) }
}

export async function saveAvailability(actor: Actor, input: AvailabilityInput): Promise<AvailabilityInput> {
  await requireSchedule(actor)
  const values = availabilitySchema.parse(input)
  const db = useDb()
  await db.transaction(async (tx) => {
    await tx.execute('SELECT pg_advisory_xact_lock(1130011)')
    await tx.insert(clinicSchedule).values({ id: 'clinic', durationMinutes: values.durationMinutes }).onConflictDoUpdate({ target: clinicSchedule.id, set: { durationMinutes: values.durationMinutes } })
    await tx.delete(openingHour)
    if (values.days.length) await tx.insert(openingHour).values(values.days)
    await tx.delete(blockedHour)
    if (values.blocked.length) await tx.insert(blockedHour).values(values.blocked.map(block => ({ id: randomUUID(), ...block })))
  })
  await recordAudit('AVAILABILITY_UPDATE', 'ALLOWED', actor.id)
  return values
}

export async function availableSlots(range: DateRange, excluding?: string): Promise<Slot[]> {
  const values = dateRangeSchema.parse(range)
  const db = useDb()
  const [settings, days, blocks, reservations] = await Promise.all([
    db.select().from(clinicSchedule), db.select().from(openingHour), db.select().from(blockedHour).where(and(gte(blockedHour.date, values.from), lte(blockedHour.date, values.to))),
    db.select({ startsAt: appointment.startsAt, endsAt: appointment.endsAt }).from(appointment).where(and(gte(appointment.startsAt, instant(values.from, '00:00')), lte(appointment.startsAt, instant(values.to, '23:59')), ne(appointment.status, 'CANCELLED'), ...(excluding ? [ne(appointment.id, excluding)] : [])))
  ])
  const durationMinutes = settings[0]?.durationMinutes ?? 30
  const slots: Slot[] = []
  for (let day = Date.parse(`${values.from}T00:00:00Z`); day <= Date.parse(`${values.to}T00:00:00Z`); day += 86400000) {
    const date = new Date(day).toISOString().slice(0, 10)
    const hours = days.find(row => row.weekday === new Date(day).getUTCDay())
    if (!hours) continue
    for (let start = minutes(hours.open); start + durationMinutes <= minutes(hours.close); start += durationMinutes) {
      const end = start + durationMinutes
      const blocked = blocks.some(block => block.date === date && start < minutes(block.to) && end > minutes(block.from))
      const startsAt = instant(date, clock(start)).getTime()
      const free = !blocked && !reservations.some(row => startsAt < row.endsAt.getTime() && startsAt + durationMinutes * 60000 > row.startsAt.getTime())
      slots.push({ date, time: clock(start), free, durationMinutes })
    }
  }
  return slots
}

export async function getAvailability(actor: Actor, range: DateRange): Promise<Slot[]> {
  await requireSchedule(actor)
  return availableSlots(range)
}
