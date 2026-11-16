import { z } from 'zod'
import { appointmentMoveSchema } from './scheduling'

export const bookingContactSchema = z.strictObject({ email: z.email().max(254).transform(value => value.trim().toLowerCase()) })
export const bookingCodeSchema = z.strictObject({ email: z.email().max(254), code: z.string().regex(/^\d{6}$/) })
const consent = { consent: z.literal(true), consentVersion: z.literal('DRAFT-2026-11') }
export const publicBookingSchema = z.strictObject({
  ...appointmentMoveSchema.shape,
  childName: z.string().trim().min(2).max(160),
  birthDate: z.iso.date(),
  sex: z.enum(['MALE', 'FEMALE']),
  guardianName: z.string().trim().min(2).max(160),
  relationship: z.string().trim().min(2).max(80),
  email: z.email().max(254).transform(value => value.trim().toLowerCase()),
  phone: z.string().regex(/^(09\d{8}|\+5939\d{8})$/),
  verificationToken: z.string().min(20),
  ...consent
})
export const parentBookingSchema = z.strictObject({ ...appointmentMoveSchema.shape, patientId: z.uuid(), ...consent })
export const bookingDecisionSchema = z.strictObject({ decision: z.enum(['APPROVE', 'DECLINE']) })
export type VerifiedBookingInput = z.input<typeof publicBookingSchema>
export type PendingRequest = { id: string, date: string, time: string, status: 'PENDING' }
export type BookingDecision = { requestId: string, status: 'APPROVED' | 'DECLINED', appointmentId?: string }
export type BookingRequestView = PendingRequest & { childName: string, guardianName: string, contact: string, source: 'PUBLIC' | 'PARENT' }
export type ParentAppointment = { id: string, name: string, date: string, time: string, status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'RESCHEDULED' | 'CANCELLED' | 'ATTENDED' }
