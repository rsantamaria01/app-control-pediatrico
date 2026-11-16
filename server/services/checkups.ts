import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import type { Actor } from '../../shared/types/access'
import { draftBadge, draftStatus } from '../../shared/types/catalog'
import { checkupInputSchema, individualCheckupSchema, type Checkup } from '../../shared/types/preventive'
import { catalogItem, catalogRelease, completedCheckup, individualCheckup, patient } from '../db/schema'
import { useDb } from '../utils/db'
import { authorizeClinical } from './patients'

function addDays(day: string, days: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
}
function addMonths(day: string, months: number) {
  const [year, month, date] = day.split('-').map(Number)
  const target = new Date(Date.UTC(year!, month! - 1 + months, 1))
  target.setUTCDate(Math.min(date!, new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()))
  return target.toISOString().slice(0, 10)
}

export async function nextCheckups(patientId: string, today = new Date()): Promise<Checkup[]> {
  const db = useDb()
  const [person] = await db.select({ id: patient.id, birthDate: patient.birthDate }).from(patient).where(eq(patient.id, patientId))
  if (!person) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  const releases = await db.select().from(catalogRelease).where(eq(catalogRelease.kind, 'CHECKUP')).orderBy(desc(catalogRelease.importedAt), desc(catalogRelease.id))
  const current = new Map<string, typeof catalogRelease.$inferSelect>()
  for (const release of releases) {
    const identity = JSON.stringify([release.publisher, release.version, release.url])
    if (!current.has(identity)) current.set(identity, release)
  }
  const completed = await db.select().from(completedCheckup).where(eq(completedCheckup.patientId, patientId))
  const completedReleases = await db.select().from(catalogRelease).where(eq(catalogRelease.kind, 'CHECKUP'))
  const identity = (release: typeof catalogRelease.$inferSelect) => JSON.stringify([release.publisher, release.version, release.url])
  const results: Checkup[] = []
  for (const release of current.values()) {
    if (release.status !== draftStatus) continue
    const items = await db.select().from(catalogItem).where(eq(catalogItem.releaseId, release.id)).orderBy(asc(catalogItem.minAgeMonths), asc(catalogItem.minAgeDays))
    for (const item of items) {
      const date = item.minAgeDays !== null ? addDays(person.birthDate, Number(item.minAgeDays)) : addMonths(person.birthDate, Number(item.minAgeMonths))
      const end = item.maxAgeDays !== null ? addDays(person.birthDate, Number(item.maxAgeDays)) : addMonths(person.birthDate, Number(item.maxAgeMonths))
      if (item.status !== draftStatus || end < today.toISOString().slice(0, 10) || completed.some(row => row.key === item.key && completedReleases.some(previous => previous.id === row.releaseId && identity(previous) === identity(release)))) continue
      results.push({ key: item.key, id: `${release.id}:${item.key}`, label: item.label, date, endDate: end, reason: null, version: release.version, source: `${release.publisher} · ${release.title}`, sourcePage: item.sourcePage, status: draftStatus, badge: draftBadge })
    }
  }
  const individual = await db.select().from(individualCheckup).where(eq(individualCheckup.patientId, patientId)).orderBy(asc(individualCheckup.date))
  for (const item of individual) {
    if (completed.some(row => row.individualId === item.id)) continue
    results.push({ key: null, id: item.id, label: 'Control individual', date: item.date, reason: item.reason, version: 'Indicación médica', source: 'Médico tratante', sourcePage: '', status: draftStatus, badge: draftBadge })
  }
  return results.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}
export async function setIndividualCheckup(actor: Actor, patientId: string, raw: unknown) {
  await authorizeClinical(actor, 'CLINICAL_WRITE', patientId)
  const input = individualCheckupSchema.parse(raw)
  const [person] = await useDb().select({ id: patient.id }).from(patient).where(eq(patient.id, patientId))
  if (!person) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  const [row] = await useDb().insert(individualCheckup).values({ id: randomUUID(), patientId, ...input, authorId: actor.id }).returning()
  return row
}
export async function recordCheckup(actor: Actor, patientId: string, raw: unknown) {
  await authorizeClinical(actor, 'CLINICAL_WRITE', patientId)
  const input = checkupInputSchema.parse(raw)
  const db = useDb()
  const [person] = await db.select({ id: patient.id }).from(patient).where(eq(patient.id, patientId))
  if (!person) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  if (input.completedAt > new Date().toISOString().slice(0, 10)) throw createError({ statusCode: 400, statusMessage: 'Invalid completion date' })
  if (input.individualId) {
    const [item] = await db.select().from(individualCheckup).where(and(eq(individualCheckup.id, input.individualId), eq(individualCheckup.patientId, patientId)))
    if (!item) throw createError({ statusCode: 404, statusMessage: 'Checkup not found' })
  } else {
    const [item] = await db.select({ id: catalogRelease.id }).from(catalogItem).innerJoin(catalogRelease, eq(catalogRelease.id, catalogItem.releaseId)).where(and(eq(catalogItem.releaseId, input.releaseId!), eq(catalogItem.key, input.key!), eq(catalogRelease.kind, 'CHECKUP')))
    if (!item) throw createError({ statusCode: 404, statusMessage: 'Checkup not found' })
  }
  const [row] = await db.insert(completedCheckup).values({ id: randomUUID(), patientId, releaseId: input.releaseId ?? null, key: input.key ?? null, individualId: input.individualId ?? null, completedAt: input.completedAt, authorId: actor.id }).returning()
  return row
}
