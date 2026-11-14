import { createHash, randomUUID } from 'node:crypto'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import { z } from 'zod'
import type { Actor } from '../../shared/types/access'
import type { GrowthResult } from '../../shared/types/clinical'
import { visitSchema, type MeasurementInput, type ShareableVisit, type VisitResultSnapshot, type VisitSnapshot } from '../../shared/types/measurement'
import type { Gender } from '../../shared/utils/enums'
import { WhoIndicator } from '../../shared/utils/enums'
import { calculateGrowth } from '../../shared/utils/growth-result'
import { bmi } from '../../shared/utils/zscore'
import { patient, visit, visitResult, visitText } from '../db/schema'
import { useDb } from '../utils/db'
import { recordAudit } from './audit'
import { authorizeClinical } from './patients'
import { selectReference } from './reference-selection'

const indicators = [WhoIndicator.HEIGHT_FOR_AGE, WhoIndicator.WEIGHT_FOR_AGE, WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE, WhoIndicator.BMI_FOR_AGE] as const

const recalculationSchema = z.strictObject({ requestId: z.uuid() })

function reviewPlausibility(results: VisitResultSnapshot[]): VisitResultSnapshot[] {
  const flagRanges: Partial<Record<WhoIndicator, [number, number]>> = {
    [WhoIndicator.HEIGHT_FOR_AGE]: [-6, 6],
    [WhoIndicator.WEIGHT_FOR_AGE]: [-6, 5],
    [WhoIndicator.WEIGHT_FOR_LENGTH]: [-5, 5],
    [WhoIndicator.WEIGHT_FOR_HEIGHT]: [-5, 5],
    [WhoIndicator.BMI_FOR_AGE]: [-5, 5],
    [WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE]: [-5, 5]
  }
  return results.map((result) => {
    if (result.status !== 'available') return result
    const [min, max] = flagRanges[result.indicator as WhoIndicator]!
    if (result.z >= min && result.z <= max) return result
    return { id: result.id, indicator: result.indicator, status: 'unavailable', reason: 'Verificar medidas con el profesional', parentResultId: result.parentResultId, recalculationId: result.recalculationId, calculatedBy: result.calculatedBy }
  })
}

export function shareableVisit(snapshot: VisitSnapshot): ShareableVisit {
  return {
    id: snapshot.id, patientId: snapshot.patientId, measuredAt: snapshot.measuredAt,
    weightKg: snapshot.weightKg, lengthHeightCm: snapshot.lengthHeightCm, position: snapshot.position,
    headCircumferenceCm: snapshot.headCircumferenceCm, bmi: snapshot.bmi,
    gestationDaysAtBirth: snapshot.gestationDaysAtBirth, authorId: snapshot.authorId,
    results: snapshot.results.filter(result => result.parentResultId === null && result.recalculationId === null).map(result => result.status === 'available'
      ? { id: result.id, indicator: result.indicator, status: result.status, sex: result.sex, z: result.z, percentile: result.percentile, classification: result.classification, reference: result.reference, parentResultId: result.parentResultId, recalculationId: result.recalculationId, calculatedBy: result.calculatedBy }
      : { id: result.id, indicator: result.indicator, status: result.status, reason: result.reason, parentResultId: result.parentResultId, recalculationId: result.recalculationId, calculatedBy: result.calculatedBy }),
    ...(snapshot.parentAdvice ? { parentAdvice: snapshot.parentAdvice } : {})
  }
}

function hydrate(row: typeof visit.$inferSelect, results: (typeof visitResult.$inferSelect)[], text?: typeof visitText.$inferSelect): VisitSnapshot {
  return {
    id: row.id, patientId: row.patientId, measuredAt: row.measuredAt.toISOString(),
    weightKg: Number(row.weightKg), lengthHeightCm: Number(row.lengthHeightCm),
    position: row.position as VisitSnapshot['position'], headCircumferenceCm: Number(row.headCircumferenceCm),
    bmi: Number(row.bmi), gestationDaysAtBirth: row.gestationDaysAtBirth, authorId: row.authorId,
    results: results.map(result => ({ ...(result.snapshot as GrowthResult), id: result.id, indicator: result.indicator, parentResultId: result.parentResultId, recalculationId: result.recalculationId, calculatedBy: result.calculatedBy } as VisitResultSnapshot)),
    ...(text?.privateNote ? { privateNote: text.privateNote } : {}),
    ...(text?.parentAdvice ? { parentAdvice: text.parentAdvice } : {}),
    ...(text?.clinicianTrend ? { clinicianTrend: text.clinicianTrend } : {})
  }
}

export async function getVisits(actor: Actor, patientId: string): Promise<VisitSnapshot[]> {
  await authorizeClinical(actor, 'CLINICAL_READ', patientId)
  const db = useDb()
  const [exists] = await db.select({ id: patient.id }).from(patient).where(eq(patient.id, patientId))
  if (!exists) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  const rows = await db.select().from(visit).where(eq(visit.patientId, patientId)).orderBy(desc(visit.measuredAt), desc(visit.createdAt))
  return Promise.all(rows.map(async (row) => {
    const [results, texts] = await Promise.all([
      db.select().from(visitResult).where(eq(visitResult.visitId, row.id)).orderBy(asc(visitResult.createdAt), asc(visitResult.id)),
      db.select().from(visitText).where(eq(visitText.visitId, row.id))
    ])
    return hydrate(row, results, texts[0])
  }))
}

export async function createVisit(actor: Actor, patientId: string, input: MeasurementInput): Promise<VisitSnapshot> {
  await authorizeClinical(actor, 'CLINICAL_WRITE', patientId)
  const values = visitSchema.parse(input)
  const measuredAt = new Date(values.measuredAt)
  if (measuredAt > new Date()) throw createError({ statusCode: 400, statusMessage: 'Future measurement' })
  const digest = createHash('sha256').update(JSON.stringify({ patientId, values })).digest('hex')
  const db = useDb()
  return db.transaction(async (tx) => {
    const [person] = await tx.select().from(patient).where(eq(patient.id, patientId))
    if (!person) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
    const birthDate = new Date(`${person.birthDate}T00:00:00.000Z`)
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(measuredAt)
    const year = Number(localDate.find(part => part.type === 'year')?.value)
    const month = Number(localDate.find(part => part.type === 'month')?.value)
    const day = Number(localDate.find(part => part.type === 'day')?.value)
    if (Date.UTC(year, month - 1, day) < birthDate.getTime()) throw createError({ statusCode: 400, statusMessage: 'Measurement before birth' })
    const ageDays = (Date.UTC(year, month - 1, day) - birthDate.getTime()) / 86400000
    const correctionEnd = new Date(Date.UTC(birthDate.getUTCFullYear(), birthDate.getUTCMonth() + person.correctionUntilMonths, birthDate.getUTCDate()))
    const referenceAge = ageDays - ((person.gestationDays !== null && person.gestationDays < 259 && Date.UTC(year, month - 1, day) <= correctionEnd.getTime()) ? 280 - person.gestationDays : 0)
    const [usedForRecalculation] = await tx.select({ id: visitResult.id }).from(visitResult).where(eq(visitResult.recalculationId, values.requestId)).limit(1)
    if (usedForRecalculation) throw createError({ statusCode: 409, statusMessage: 'Request ID already used' })
    const id = randomUUID()
    const computedBmi = bmi(values.weightKg, values.lengthHeightCm + (referenceAge <= 730 ? (values.position === 'STANDING' ? 0.7 : 0) : (values.position === 'RECUMBENT' ? -0.7 : 0)))
    const [inserted] = await tx.insert(visit).values({
      id, patientId, requestId: values.requestId, requestDigest: digest, measuredAt,
      weightKg: values.weightKg.toString(), lengthHeightCm: values.lengthHeightCm.toString(),
      position: values.position, headCircumferenceCm: values.headCircumferenceCm.toString(),
      bmi: computedBmi.toString(), gestationDaysAtBirth: person.gestationDays,
      birthDateAtVisit: person.birthDate, sexAtVisit: person.sex,
      correctionUntilMonths: person.correctionUntilMonths, authorId: actor.id
    }).onConflictDoNothing({ target: visit.requestId }).returning()
    if (!inserted) {
      const [existing] = await tx.select().from(visit).where(eq(visit.requestId, values.requestId))
      if (!existing || existing.requestDigest !== digest) throw createError({ statusCode: 409, statusMessage: 'Request ID already used' })
      const [results, texts] = await Promise.all([
        tx.select().from(visitResult).where(and(eq(visitResult.visitId, existing.id), isNull(visitResult.recalculationId))),
        tx.select().from(visitText).where(eq(visitText.visitId, existing.id))
      ])
      return hydrate(existing, results, texts[0])
    }
    const weightForSize = referenceAge <= 730 ? WhoIndicator.WEIGHT_FOR_LENGTH : WhoIndicator.WEIGHT_FOR_HEIGHT
    const results: VisitResultSnapshot[] = []
    for (const indicator of [...indicators, weightForSize]) {
      const selected = await selectReference({
        birthDate, measuredAt, gestationDays: person.gestationDays ?? undefined,
        correctionUntilMonths: person.correctionUntilMonths as 24 | 36,
        measuredLengthHeightCm: values.lengthHeightCm, position: values.position,
        indicator, sex: person.sex as Gender
      })
      const growth = calculateGrowth({ sex: person.sex as Gender, weightKg: values.weightKg, lengthHeightCm: values.lengthHeightCm, headCircumferenceCm: values.headCircumferenceCm }, selected)
      const result: VisitResultSnapshot = { ...growth, id: randomUUID(), indicator, parentResultId: null, recalculationId: null, calculatedBy: actor.id }
      results.push(result)
    }
    const reviewed = reviewPlausibility(results)
    for (const result of reviewed) await tx.insert(visitResult).values({ id: result.id, visitId: id, indicator: result.indicator, snapshot: result.status === 'available' ? { status: result.status, indicator: result.indicator, sex: result.sex, z: result.z, percentile: result.percentile, classification: result.classification, reference: result.reference } : { status: result.status, reason: result.reason }, calculatedBy: actor.id })
    await tx.insert(visitText).values({ visitId: id, privateNote: values.privateNote, parentAdvice: values.parentAdvice, clinicianTrend: values.clinicianTrend })
    return hydrate(inserted, reviewed.map(result => ({ id: result.id, visitId: id, indicator: result.indicator, snapshot: result, parentResultId: null, recalculationId: null, calculatedBy: actor.id, createdAt: new Date() })), { visitId: id, privateNote: values.privateNote ?? null, parentAdvice: values.parentAdvice ?? null, clinicianTrend: values.clinicianTrend ?? null })
  })
}

export async function recalculateVisit(actor: Actor, patientId: string, visitId: string, input: { requestId: string }): Promise<{ id: string, visitId: string, results: VisitResultSnapshot[] }> {
  const allowed = actor.roles.includes('DOCTOR')
  if (!allowed) {
    await recordAudit('CLINICAL_RECALCULATE', 'DENIED', actor.id, patientId)
    throw createError({ statusCode: 403, statusMessage: 'Access denied' })
  }
  const { requestId } = recalculationSchema.parse(input)
  const db = useDb()
  let result: { id: string, visitId: string, results: VisitResultSnapshot[] }
  try {
    result = await db.transaction(async (tx) => {
      const [usedForVisit] = await tx.select({ id: visit.id }).from(visit).where(eq(visit.requestId, requestId))
      if (usedForVisit) throw createError({ statusCode: 409, statusMessage: 'Request ID already used' })
      const [original] = await tx.select().from(visit).where(and(eq(visit.id, visitId), eq(visit.patientId, patientId))).for('update')
      if (!original) throw createError({ statusCode: 404, statusMessage: 'Visit not found' })
      const existing = await tx.select().from(visitResult).where(and(eq(visitResult.visitId, visitId), eq(visitResult.recalculationId, requestId))).orderBy(asc(visitResult.createdAt), asc(visitResult.id))
      if (existing.length) {
        const order = [...indicators, WhoIndicator.WEIGHT_FOR_LENGTH, WhoIndicator.WEIGHT_FOR_HEIGHT]
        return { id: requestId, visitId, results: hydrate(original, existing).results.sort((a, b) => order.indexOf(a.indicator as WhoIndicator) - order.indexOf(b.indicator as WhoIndicator)) }
      }
      const [person] = await tx.select().from(patient).where(eq(patient.id, patientId))
      if (!person) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
      const prior = await tx.select().from(visitResult).where(and(eq(visitResult.visitId, visitId), isNull(visitResult.recalculationId)))
      if (prior.length !== 5) throw createError({ statusCode: 409, statusMessage: 'Incomplete original results' })
      if (!original.birthDateAtVisit || !original.sexAtVisit) throw createError({ statusCode: 409, statusMessage: 'Historical patient identity unavailable' })
      const birthDate = new Date(`${original.birthDateAtVisit}T00:00:00.000Z`)
      const measuredAt = original.measuredAt
      const sex = original.sexAtVisit as Gender
      const lengthHeightCm = Number(original.lengthHeightCm)
      const weightKg = Number(original.weightKg)
      const headCircumferenceCm = Number(original.headCircumferenceCm)
      const position = original.position as 'RECUMBENT' | 'STANDING'
      const selectionInput = { birthDate, measuredAt, gestationDays: original.gestationDaysAtBirth ?? undefined, correctionUntilMonths: original.correctionUntilMonths as 24 | 36, measuredLengthHeightCm: lengthHeightCm, position, sex }
      const indicator = prior.find(row => row.indicator === WhoIndicator.WEIGHT_FOR_LENGTH || row.indicator === WhoIndicator.WEIGHT_FOR_HEIGHT)?.indicator as WhoIndicator | undefined
      if (!indicator) throw createError({ statusCode: 409, statusMessage: 'Original size indicator missing' })
      const indicatorsToRecalculate = [...indicators, indicator]
      const snapshots: VisitResultSnapshot[] = []
      for (const current of indicatorsToRecalculate) {
        const source = prior.find(row => row.indicator === current)
        if (!source) throw createError({ statusCode: 409, statusMessage: 'Original indicator missing' })
        const selected = await selectReference({ ...selectionInput, indicator: current })
        const growth = calculateGrowth({ sex, weightKg, lengthHeightCm, headCircumferenceCm }, selected)
        const id = randomUUID()
        snapshots.push({ ...growth, id, indicator: current, parentResultId: source.id, recalculationId: requestId, calculatedBy: actor.id })
      }
      const reviewed = reviewPlausibility(snapshots)
      for (const entry of reviewed) await tx.insert(visitResult).values({ id: entry.id, visitId, indicator: entry.indicator, snapshot: entry.status === 'available' ? { status: entry.status, indicator: entry.indicator, sex: entry.sex, z: entry.z, percentile: entry.percentile, classification: entry.classification, reference: entry.reference } : { status: entry.status, reason: entry.reason }, parentResultId: entry.parentResultId, recalculationId: requestId, calculatedBy: actor.id })
      return { id: requestId, visitId, results: reviewed }
    })
  } catch (error) {
    await recordAudit('CLINICAL_RECALCULATE', 'DENIED', actor.id, patientId)
    throw error
  }
  await recordAudit('CLINICAL_RECALCULATE', 'ALLOWED', actor.id, patientId)
  return result
}
