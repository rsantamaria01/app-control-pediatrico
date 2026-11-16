import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { draftBadge, draftStatus } from '../../shared/types/catalog'
import { createError } from 'nuxt/server'
import type { Actor } from '../../shared/types/access'
import { assessmentInputSchema, screeningResultSchema, type Assessment, type AssessmentInput, type Screening, type ScreeningResult } from '../../shared/types/preventive'
import { catalogItem, catalogRelease, doctorCatalogEntry, milestoneAssessment, patient, screeningApplication } from '../db/schema'
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
export async function listDevelopment(actor: Actor, patientId: string, today = new Date()) {
  await authorizeClinical(actor, 'CLINICAL_READ', patientId)
  await requirePatient(patientId)
  const db = useDb()
  const assessments = await db.select().from(milestoneAssessment).where(eq(milestoneAssessment.patientId, patientId)).orderBy(desc(milestoneAssessment.recordedAt))
  const screenings = await db.select().from(screeningApplication).where(eq(screeningApplication.patientId, patientId)).orderBy(desc(screeningApplication.recordedAt))
  const milestones = await db.select().from(doctorCatalogEntry).orderBy(desc(doctorCatalogEntry.createdAt))
  const releases = await db.select().from(catalogRelease).where(eq(catalogRelease.kind, 'SCREENING')).orderBy(desc(catalogRelease.importedAt), desc(catalogRelease.id))
  const current = new Map<string, typeof catalogRelease.$inferSelect>()
  for (const release of releases) {
    const identity = JSON.stringify([release.publisher, release.version, release.url])
    if (!current.has(identity)) current.set(identity, release)
  }
  const [person] = await db.select({ birthDate: patient.birthDate }).from(patient).where(eq(patient.id, patientId))
  const age = person ? (today.getUTCFullYear() - Number(person.birthDate.slice(0, 4))) * 12 + today.getUTCMonth() + 1 - Number(person.birthDate.slice(5, 7)) - (today.getUTCDate() < Number(person.birthDate.slice(8, 10)) ? 1 : 0) : -1
  const reminders = [] as { key: string, label: string, category: string, ageMonths: number, version: string, source: string, sourcePage: string, badge: typeof draftBadge }[]
  for (const release of current.values()) {
    if (release.status !== draftStatus) continue
    const items = await db.select().from(catalogItem).where(eq(catalogItem.releaseId, release.id))
    for (const item of items) {
      const [year, month, day] = person!.birthDate.split('-').map(Number)
      const due = new Date(Date.UTC(year!, month! - 1 + Number(item.minAgeMonths), day!)).toISOString().slice(0, 10)
      if (item.status !== draftStatus || age < Number(item.minAgeMonths) || screenings.some(screening => screening.category === item.domain && screening.appliedAt >= due)) continue
      reminders.push({ key: item.key, label: item.label, category: item.domain, ageMonths: Number(item.minAgeMonths), version: release.version, source: `${release.publisher} · ${release.title}`, sourcePage: item.sourcePage, badge: draftBadge })
    }
  }
  return { assessments: assessments.map(row => ({ ...row, acquiredAgeMonths: row.acquiredAgeMonths === null ? null : Number(row.acquiredAgeMonths) })), screenings, milestones, reminders, remindersAvailable: current.size > 0 }
}
