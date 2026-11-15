import { and, desc, eq, isNull } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import type { Actor } from '../../shared/types/access'
import { patient, visit, visitResult } from '../db/schema'
import { useDb } from '../utils/db'
import { recordAudit } from './audit'

export type GrowthReading = { measuredAt: string, indicator: string, z: number | null, reference: string, ageBasis: string }
export type GrowthReviewConfig = { outsideZ: number, deltaZ: number, minDays: number }
const defaults: GrowthReviewConfig = { outsideZ: 2, deltaZ: 1, minDays: 28 }

export function evaluateGrowthReview(readings: GrowthReading[], options: GrowthReviewConfig = defaults): string[] {
  if (![options.outsideZ, options.deltaZ, options.minDays].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid review configuration')
  const groups = new Map<string, GrowthReading[]>()
  for (const reading of readings) groups.set(reading.indicator, [...(groups.get(reading.indicator) ?? []), reading])
  const matches: string[] = []
  for (const [indicator, rows] of groups) {
    const ordered = rows.toSorted((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt))
    const [latest] = ordered
    if (latest?.z === null || latest?.z === undefined || !latest.reference || !latest.ageBasis) continue
    const comparable = ordered.find(row => row !== latest && row.z !== null && row.reference === latest.reference && row.ageBasis === latest.ageBasis && Date.parse(latest.measuredAt) - Date.parse(row.measuredAt) >= options.minDays * 86400000)
    if (Math.abs(latest.z) > options.outsideZ || (comparable?.z !== null && comparable?.z !== undefined && Math.abs(latest.z - comparable.z) >= options.deltaZ)) matches.push(indicator)
  }
  return matches
}

export async function listGrowthReview(actor: Actor, options: GrowthReviewConfig = defaults): Promise<{ id: string, name: string, indicators: string[] }[]> {
  if (!actor.roles.includes('DOCTOR')) {
    await recordAudit('GROWTH_REVIEW', 'DENIED', actor.id)
    throw createError({ statusCode: 403, statusMessage: 'Access denied' })
  }
  await recordAudit('GROWTH_REVIEW', 'ALLOWED', actor.id)
  const db = useDb()
  const people = await db.select({ id: patient.id, name: patient.name }).from(patient).orderBy(patient.name)
  const review: { id: string, name: string, indicators: string[] }[] = []
  for (const person of people) {
    const history = await db.select({ measuredAt: visit.measuredAt, indicator: visitResult.indicator, snapshot: visitResult.snapshot }).from(visit).innerJoin(visitResult, eq(visitResult.visitId, visit.id)).where(and(eq(visit.patientId, person.id), isNull(visitResult.recalculationId))).orderBy(desc(visit.measuredAt), desc(visit.createdAt))
    const readings: GrowthReading[] = history.map((row) => {
      const snapshot = row.snapshot as { status: string, z?: number, reference?: { version: string, datasetId: string, ageBasis: string } }
      return { measuredAt: row.measuredAt.toISOString(), indicator: row.indicator, z: snapshot.status === 'available' && typeof snapshot.z === 'number' ? snapshot.z : null, reference: snapshot.reference ? `${snapshot.reference.version}:${snapshot.reference.datasetId}` : '', ageBasis: snapshot.reference?.ageBasis ?? '' }
    })
    const indicators = evaluateGrowthReview(readings, options)
    if (indicators.length) review.push({ id: person.id, name: person.name, indicators })
  }
  return review
}
