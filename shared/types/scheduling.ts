import { z } from 'zod'

const date = z.iso.date().refine(value => new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value)
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export const dateRangeSchema = z.strictObject({ from: date, to: date }).refine(value => value.to >= value.from && (Date.parse(value.to) - Date.parse(value.from)) <= 31 * 86400000)
export const availabilitySchema = z.strictObject({
  days: z.array(z.strictObject({ weekday: z.number().int().min(0).max(6), open: time, close: time }).refine(day => day.open < day.close)).max(7).refine(days => new Set(days.map(day => day.weekday)).size === days.length),
  durationMinutes: z.number().int().min(15).max(120),
  blocked: z.array(z.strictObject({ date, from: time, to: time }).refine(block => block.from < block.to)).max(366)
})
const appointmentFields = { date, time, name: z.string().trim().min(2).max(160), contact: z.string().trim().min(3).max(160), status: z.enum(['PENDING', 'CONFIRMED']).default('CONFIRMED') }
export const assistantAppointmentSchema = z.strictObject(appointmentFields)
export const appointmentSchema = z.strictObject({ ...appointmentFields, reason: z.string().trim().min(2).max(500), patientId: z.uuid().optional() })
export const appointmentMoveSchema = z.strictObject({ date, time })
export type DateRange = z.infer<typeof dateRangeSchema>
export type Slot = { date: string, time: string, free: boolean, durationMinutes: number }
export type AvailabilityInput = z.infer<typeof availabilitySchema>
export type AppointmentInput = z.input<typeof appointmentSchema> | z.input<typeof assistantAppointmentSchema>
export type Appointment = { id: string, date: string, time: string, name: string, contact: string, status: string, reason?: string, patientId?: string, birthDate?: string, lastWeightKg?: number }
