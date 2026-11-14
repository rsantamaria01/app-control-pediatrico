import { z } from 'zod'
import { Gender } from '../utils/enums'
import type { GrowthResult } from './clinical'

const dateOnly = z.iso.date().refine(value => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value)
const positive = (max: number) => z.number().finite().positive().max(max)

export const patientSchema = z.strictObject({
  name: z.string().trim().min(2).max(160),
  birthDate: dateOnly,
  sex: z.enum(Gender),
  gestationDays: z.number().int().min(140).max(301).optional(),
  correctionUntilMonths: z.union([z.literal(24), z.literal(36)]).default(24),
  birthWeightKg: positive(20).optional(),
  birthLengthCm: positive(80).optional(),
  birthHeadCircumferenceCm: positive(60).optional()
}).refine(value => value.correctionUntilMonths !== 36 || (value.gestationDays !== undefined && value.gestationDays < 196), { path: ['correctionUntilMonths'], message: 'Solo prematuridad extrema' })

export const visitSchema = z.strictObject({
  requestId: z.uuid(),
  measuredAt: z.iso.datetime({ offset: true }),
  weightKg: positive(100),
  lengthHeightCm: z.number().finite().min(40).max(200),
  position: z.enum(['RECUMBENT', 'STANDING']),
  headCircumferenceCm: z.number().finite().min(20).max(65),
  privateNote: z.string().trim().max(10000).optional(),
  parentAdvice: z.string().trim().max(10000).optional(),
  clinicianTrend: z.string().trim().max(1000).optional()
}).superRefine((value, context) => {
  const weightToHeight = value.weightKg / (value.lengthHeightCm / 100) ** 2
  if (weightToHeight < 2 || weightToHeight > 90) context.addIssue({ code: 'custom', path: ['weightKg'], message: 'Medidas incompatibles; verifique los datos' })
})

export type PatientInput = z.input<typeof patientSchema>
export type MeasurementInput = z.input<typeof visitSchema>
export type PatientView = z.output<typeof patientSchema> & { id: string, createdBy: string }
export type VisitResultSnapshot = { id: string, indicator: string, parentResultId: string | null, recalculationId: string | null, calculatedBy: string | null } & (GrowthResult | { status: 'unavailable', reason: string })
export type VisitSnapshot = {
  id: string
  patientId: string
  measuredAt: string
  weightKg: number
  lengthHeightCm: number
  position: 'RECUMBENT' | 'STANDING'
  headCircumferenceCm: number
  bmi: number
  gestationDaysAtBirth: number | null
  authorId: string
  results: VisitResultSnapshot[]
  privateNote?: string
  parentAdvice?: string
  clinicianTrend?: string
}
export type ShareableVisit = Omit<VisitSnapshot, 'privateNote' | 'clinicianTrend' | 'bmi'> & { bmi: number | null }
