import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import type { Actor } from '../../shared/types/access'
import { assessmentInputSchema, screeningResultSchema, type Assessment, type AssessmentInput, type Screening, type ScreeningResult } from '../../shared/types/preventive'
import { doctorCatalogEntry, milestoneAssessment, patient, screeningApplication } from '../db/schema'
import { useDb } from '../utils/db'
import { authorizeClinical } from './patients'

async function requirePatient(id: string) {
  const [row] = await useDb().select({ id: patient.id }).from(patient).where(eq(patient.id, id))
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
}
export async function assessMilestone(actor: Actor, patientId: string, raw: AssessmentInput): Promise<Assessment> {
  await authorizeClinical(actor, 'CLINICAL_WRITE', patientId)
  const input = assessmentInputSchema.parse(raw)
  await requirePatient(patientId)
  const [row] = await useDb().insert(milestoneAssessment).values({ id: randomUUID(), patientId, label: input.label, domain: input.domain, outcome: input.outcome, acquiredAgeMonths: input.acquiredAgeMonths === undefined ? null : String(input.acquiredAgeMonths), privateNote: input.privateNote ?? null, authorId: actor.id }).returning()
  return { id: row!.id, patientId, label: row!.label, domain: input.domain, outcome: input.outcome, ...(input.acquiredAgeMonths !== undefined ? { acquiredAgeMonths: input.acquiredAgeMonths } : {}), ...(row!.privateNote ? { privateNote: row!.privateNote } : {}), recordedAt: row!.recordedAt.toISOString() }
}
export async function recordScreening(actor: Actor, patientId: string, instrument: string, raw: ScreeningResult): Promise<Screening> {
  await authorizeClinical(actor, 'CLINICAL_WRITE', patientId)
  const input = screeningResultSchema.parse(raw)
  if (!instrument.trim() || instrument.length > 200 || input.appliedAt > new Date().toISOString().slice(0, 10)) throw createError({ statusCode: 400, statusMessage: 'Invalid screening application' })
  await requirePatient(patientId)
  const [row] = await useDb().insert(screeningApplication).values({ id: randomUUID(), patientId, instrument: instrument.trim(), ...input, authorId: actor.id }).returning()
  return { id: row!.id, patientId, instrument: row!.instrument, category: input.category, appliedAt: input.appliedAt, result: input.result, ...(input.privateNote ? { privateNote: input.privateNote } : {}), recordedAt: row!.recordedAt.toISOString() }
}
export async function listDevelopment(actor: Actor, patientId: string) {
  await authorizeClinical(actor, 'CLINICAL_READ', patientId)
  await requirePatient(patientId)
  const db = useDb()
  const assessments = await db.select().from(milestoneAssessment).where(eq(milestoneAssessment.patientId, patientId)).orderBy(desc(milestoneAssessment.recordedAt))
  const screenings = await db.select().from(screeningApplication).where(eq(screeningApplication.patientId, patientId)).orderBy(desc(screeningApplication.recordedAt))
  const milestones = await db.select().from(doctorCatalogEntry).orderBy(desc(doctorCatalogEntry.createdAt))
  return { assessments: assessments.map(row => ({ ...row, acquiredAgeMonths: row.acquiredAgeMonths === null ? null : Number(row.acquiredAgeMonths) })), screenings, milestones, reminders: [] as never[] }
}
