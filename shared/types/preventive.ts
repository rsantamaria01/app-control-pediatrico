import { z } from 'zod'
import type { draftBadge, draftStatus } from './catalog'

const day = z.iso.date()
export const doseInputSchema = z.strictObject({
  releaseId: z.string().min(1).optional(),
  key: z.string().min(1).optional(),
  complementaryId: z.uuid().optional(),
  appliedAt: day,
  lot: z.string().trim().max(120).optional(),
  privateNote: z.string().trim().max(2000).optional(),
  external: z.boolean().default(false)
}).refine(value => Boolean(value.complementaryId) !== Boolean(value.releaseId && value.key))
export type DoseInput = z.input<typeof doseInputSchema>
export type DoseRecord = { id: string, patientId: string, releaseId: string | null, key: string, label: string, doseLabel: string | null, catalogVersion: string, sourcePage: string, sourceStatus: typeof draftStatus, appliedAt: string, external: boolean, lot: string | null, privateNote: string | null }
export const complementaryInputSchema = z.strictObject({ label: z.string().trim().min(2).max(200), doseLabel: z.string().trim().min(1).max(120), source: z.string().trim().min(8).max(500), patientId: z.uuid() })
export type ComplementaryInput = z.input<typeof complementaryInputSchema>
export type PendingVaccine = { kind: 'MSP' | 'COMPLEMENTARY', id: string, key: string, label: string, doseLabel: string | null, version: string, sourcePage: string, source: string, minimumInterval: string | null, recommendedAge: string | null, status: typeof draftStatus, badge: typeof draftBadge, review: 'PENDING_REVIEW' }
export const assessmentInputSchema = z.strictObject({ label: z.string().trim().min(2).max(200), domain: z.enum(['GROSS_MOTOR', 'FINE_MOTOR', 'LANGUAGE', 'SOCIAL', 'COGNITIVE']), outcome: z.enum(['ACHIEVED', 'NOT_ACHIEVED', 'NOT_ASSESSED']), acquiredAgeMonths: z.number().min(0).max(252).optional(), privateNote: z.string().trim().max(2000).optional() }).refine(value => (value.outcome === 'ACHIEVED') === (value.acquiredAgeMonths !== undefined))
export type AssessmentInput = z.input<typeof assessmentInputSchema>
export type Assessment = z.output<typeof assessmentInputSchema> & { id: string, patientId: string, recordedAt: string }
export const screeningResultSchema = z.strictObject({ category: z.enum(['DEVELOPMENT', 'AUTISM']), appliedAt: day, result: z.string().trim().min(1).max(1000), privateNote: z.string().trim().max(2000).optional() })
export type ScreeningResult = z.input<typeof screeningResultSchema>
export type Screening = ScreeningResult & { id: string, patientId: string, instrument: string, recordedAt: string }
export const checkupInputSchema = z.strictObject({ releaseId: z.string().min(1).optional(), key: z.string().min(1).optional(), individualId: z.uuid().optional(), completedAt: day }).refine(value => Boolean(value.individualId) !== Boolean(value.releaseId && value.key))
export const individualCheckupSchema = z.strictObject({ date: day, reason: z.string().trim().min(2).max(500) })
export type Checkup = { key: string | null, id: string, label: string, date: string | null, reason: string | null, version: string, source: string, sourcePage: string, status: typeof draftStatus, badge: typeof draftBadge }
