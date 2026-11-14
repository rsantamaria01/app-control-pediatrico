import { createHash, randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import type { Actor } from '../../shared/types/access'
import type { GrowthResult } from '../../shared/types/clinical'
import { visitSchema, type MeasurementInput, type ShareableVisit, type VisitResultSnapshot, type VisitSnapshot } from '../../shared/types/measurement'
import type { Gender } from '../../shared/utils/enums'
import { WhoIndicator } from '../../shared/utils/enums'
import { calculateGrowth } from '../../shared/utils/growth-result'
import { bmi } from '../../shared/utils/zscore'
import { patient, visit, visitResult, visitText } from '../db/schema'
import { useDb } from '../utils/db'
import { authorizeClinical } from './patients'
import { selectReference } from './reference-selection'

const indicators = [WhoIndicator.HEIGHT_FOR_AGE, WhoIndicator.WEIGHT_FOR_AGE, WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE, WhoIndicator.BMI_FOR_AGE] as const

export function shareableVisit(snapshot: VisitSnapshot): ShareableVisit {
  return {
    id: snapshot.id, patientId: snapshot.patientId, measuredAt: snapshot.measuredAt,
    weightKg: snapshot.weightKg, lengthHeightCm: snapshot.lengthHeightCm, position: snapshot.position,
    headCircumferenceCm: snapshot.headCircumferenceCm, bmi: snapshot.bmi,
    gestationDaysAtBirth: snapshot.gestationDaysAtBirth, authorId: snapshot.authorId,
    results: snapshot.results.map(result => result.status === 'available'
      ? { id: result.id, indicator: result.indicator, status: result.status, sex: result.sex, z: result.z, percentile: result.percentile, classification: result.classification, reference: result.reference }
      : { id: result.id, indicator: result.indicator, status: result.status, reason: result.reason }),
    ...(snapshot.parentAdvice ? { parentAdvice: snapshot.parentAdvice } : {})
  }
}

function hydrate(row: typeof visit.$inferSelect, results: (typeof visitResult.$inferSelect)[], text?: typeof visitText.$inferSelect): VisitSnapshot {
  return {
    id: row.id, patientId: row.patientId, measuredAt: row.measuredAt.toISOString(),
    weightKg: Number(row.weightKg), lengthHeightCm: Number(row.lengthHeightCm),
    position: row.position as VisitSnapshot['position'], headCircumferenceCm: Number(row.headCircumferenceCm),
    bmi: Number(row.bmi), gestationDaysAtBirth: row.gestationDaysAtBirth, authorId: row.authorId,
    results: results.map(result => ({ ...(result.snapshot as GrowthResult), id: result.id, indicator: result.indicator } as VisitResultSnapshot)),
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
      db.select().from(visitResult).where(eq(visitResult.visitId, row.id)),
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
    const id = randomUUID()
    const computedBmi = bmi(values.weightKg, values.lengthHeightCm + (referenceAge <= 730 ? (values.position === 'STANDING' ? 0.7 : 0) : (values.position === 'RECUMBENT' ? -0.7 : 0)))
    const [inserted] = await tx.insert(visit).values({
      id, patientId, requestId: values.requestId, requestDigest: digest, measuredAt,
      weightKg: values.weightKg.toString(), lengthHeightCm: values.lengthHeightCm.toString(),
      position: values.position, headCircumferenceCm: values.headCircumferenceCm.toString(),
      bmi: computedBmi.toString(), gestationDaysAtBirth: person.gestationDays,
      correctionUntilMonths: person.correctionUntilMonths, authorId: actor.id
    }).onConflictDoNothing({ target: visit.requestId }).returning()
    if (!inserted) {
      const [existing] = await tx.select().from(visit).where(eq(visit.requestId, values.requestId))
      if (!existing || existing.requestDigest !== digest) throw createError({ statusCode: 409, statusMessage: 'Request ID already used' })
      const [results, texts] = await Promise.all([
        tx.select().from(visitResult).where(eq(visitResult.visitId, existing.id)),
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
      const result: VisitResultSnapshot = { ...growth, id: randomUUID(), indicator }
      await tx.insert(visitResult).values({ id: result.id, visitId: id, indicator, snapshot: growth })
      results.push(result)
    }
    await tx.insert(visitText).values({ visitId: id, privateNote: values.privateNote, parentAdvice: values.parentAdvice, clinicianTrend: values.clinicianTrend })
    return hydrate(inserted, results.map(result => ({ id: result.id, visitId: id, indicator: result.indicator, snapshot: result, createdAt: new Date() })), { visitId: id, privateNote: values.privateNote ?? null, parentAdvice: values.parentAdvice ?? null, clinicianTrend: values.clinicianTrend ?? null })
  })
}
