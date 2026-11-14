import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { eq } from 'drizzle-orm'
import { Pool } from 'pg'
import manifest from '../../scripts/who-2006-manifest.json'
import { importWhoRelease, parseWhoWorkbook } from '../../server/services/who-import'
import { createPatient, getPatient, listPatients } from '../../server/services/patients'
import { createVisit, getVisits, recalculateVisit, shareableVisit } from '../../server/services/visits'
import { auditEvent, patient, visit, visitResult } from '../../server/db/schema'
import type { VerifiedSource } from '../../shared/types/who'
import type { Actor } from '../../shared/types/access'
import { Gender, WhoIndicator } from '../../shared/utils/enums'

const configured = process.env.WHO_TEST_DATABASE_URL
if (!configured || !['/pediatrico_who_slice3_test', '/pediatrico_who_slice3_verify', '/pediatrico_who_slice3_guard', '/pediatrico_who_slice3_sealed_test'].includes(new URL(configured).pathname) || configured === process.env.DATABASE_URL) throw new Error('Dedicated WHO test database required')
const name = `pediatrico_slice6_${randomUUID().replace(/-/g, '')}`
const target = new URL(configured)
target.pathname = `/${name}`
const admin = new URL(configured)
admin.pathname = '/postgres'
const adminPool = new Pool({ connectionString: admin.href })
const pool = new Pool({ connectionString: target.href })
const db = drizzle(pool)
const previous = process.env.DATABASE_URL
let created = false
const doctor: Actor = { id: randomUUID(), roles: ['DOCTOR'] }
const otherDoctor: Actor = { id: randomUUID(), roles: ['DOCTOR'] }
const adminOnly: Actor = { id: randomUUID(), roles: ['ADMIN'] }
const assistant: Actor = { id: randomUUID(), roles: ['ASSISTANT'] }
const birthDate = '2024-01-01'
const patientInput = { name: 'Niña Prueba', birthDate, sex: Gender.FEMALE, gestationDays: 195, correctionUntilMonths: 36 as const }
const measurement = { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00.000Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT' as const, headCircumferenceCm: 45, privateNote: 'Confidencial clínico', parentAdvice: 'Conversar en consulta', clinicianTrend: 'Seguimiento manual' }

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${name}"`)
  created = true
  process.env.DATABASE_URL = target.href
  await migrate(db, { migrationsFolder: './server/db/migrations' })
}, 120000)
afterAll(async () => {
  process.env.DATABASE_URL = previous
  await pool.end()
  const { useDb } = await import('../../server/utils/db')
  await useDb().$client.end()
  try {
    if (created) await adminPool.query(`DROP DATABASE "${name}"`)
  } finally {
    await adminPool.end()
  }
})

async function importRelease() {
  const entries = await Promise.all(manifest.files.map(async (file) => {
    const bytes = await readFile(resolve('/tmp/opencode/who-2006', `${file.name}-expanded.xlsx`))
    const indicator = file.indicator as WhoIndicator
    const isLength = indicator === WhoIndicator.WEIGHT_FOR_LENGTH
    const isHeight = indicator === WhoIndicator.WEIGHT_FOR_HEIGHT
    const source: VerifiedSource = {
      publisher: 'WHO', standard: 'WHO_2006', version: manifest.version,
      publicationDate: file.publicationDate, retrievedAt: manifest.retrievedAt,
      url: file.url, sha256: file.sha256, bytes, indicator, sex: file.sex as Gender,
      position: isLength ? 'RECUMBENT' : isHeight ? 'STANDING' : null,
      xUnit: isLength || isHeight ? 'CM' : 'DAY', minX: isLength ? 45 : isHeight ? 65 : 0,
      maxX: isLength ? 110 : isHeight ? 120 : 1856, step: isLength || isHeight ? 0.1 : 1
    }
    return { source, rows: await parseWhoWorkbook(source, bytes) }
  }))
  await importWhoRelease(entries)
}

describe('clinical patients and visits on a disposable WHO database', () => {
  it('appends identified WHO results after an approved import while preserving the unavailable originals', async () => {
    const created = await createPatient(doctor, patientInput)
    const snapshot = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID() })
    expect(snapshot.results.every(result => result.status === 'unavailable')).toBe(true)
    expect(snapshot.results).toHaveLength(5)
    expect(JSON.stringify(shareableVisit(snapshot))).not.toContain('Confidencial clínico')
    expect(JSON.stringify(shareableVisit(snapshot))).not.toContain('Seguimiento manual')
    expect(shareableVisit(snapshot).parentAdvice).toBe('Conversar en consulta')
    expect((await db.select().from(visitResult).where(eq(visitResult.visitId, snapshot.id)))).toHaveLength(5)
    await importRelease()
    expect((await getVisits(doctor, created.id))[0]?.results.every(result => result.status === 'unavailable')).toBe(true)
    const initial = snapshot
    const recalculated = await recalculateVisit(otherDoctor, created.id, initial.id, { requestId: randomUUID() })
    expect(recalculated.results).toHaveLength(5)
    expect(recalculated.results.find(result => result.indicator === WhoIndicator.WEIGHT_FOR_AGE)).toMatchObject({ status: 'available', sex: Gender.FEMALE, reference: { version: manifest.version } })
    expect(recalculated.results.every(result => result.parentResultId && initial.results.some(original => original.id === result.parentResultId && original.indicator === result.indicator))).toBe(true)
    expect(recalculated.results.every(result => !initial.results.some(original => original.id === result.id))).toBe(true)
    const stored = (await getVisits(doctor, created.id))[0]!
    expect(stored.results.filter(result => result.parentResultId === null).toSorted((a, b) => a.indicator.localeCompare(b.indicator))).toEqual(initial.results.toSorted((a, b) => a.indicator.localeCompare(b.indicator)))
    expect(stored.results).toHaveLength(10)
    expect(stored.weightKg).toBe(initial.weightKg)
    expect(stored.privateNote).toBe('Confidencial clínico')
    expect(JSON.stringify(recalculated)).not.toContain('Confidencial clínico')
    expect((await db.select().from(auditEvent).where(eq(auditEvent.subjectId, created.id))).some(event => event.action === 'CLINICAL_RECALCULATE' && event.actorId === otherDoctor.id && event.outcome === 'ALLOWED')).toBe(true)
  }, 120000)

  it('rejects non-doctors, invalid birth/gestation and preserves doctor-wide access with read audit', async () => {
    await expect(createPatient(adminOnly, patientInput)).rejects.toThrow()
    await expect(createPatient(assistant, patientInput)).rejects.toThrow()
    await expect(createPatient(doctor, { ...patientInput, birthDate: '2024-02-30' })).rejects.toThrow()
    await expect(createPatient(doctor, { ...patientInput, gestationDays: 302 })).rejects.toThrow()
    const created = await createPatient(doctor, patientInput)
    expect(created).toMatchObject(patientInput)
    expect(await getPatient(otherDoctor, created.id)).toMatchObject({ id: created.id, name: patientInput.name })
    expect((await listPatients(otherDoctor, 'Niña')).map(item => item.id)).toContain(created.id)
    expect((await listPatients(otherDoctor, 'Ni_a')).map(item => item.id)).not.toContain(created.id)
    await expect(listPatients(assistant, '')).rejects.toThrow()
    await expect(getPatient(adminOnly, created.id)).rejects.toThrow()
    expect((await db.select().from(auditEvent).where(eq(auditEvent.subjectId, created.id))).map(row => row.action)).toContain('CLINICAL_READ')
  })

  it('accepts a post-term 42-week birth without correction and rejects unsupported gestational values', async () => {
    const postTerm = await createPatient(doctor, { name: 'Postérmino', birthDate, sex: Gender.MALE, gestationDays: 294 })
    expect(postTerm.gestationDays).toBe(294)
    await expect(createPatient(doctor, { name: 'Fuera de rango', birthDate, sex: Gender.MALE, gestationDays: 302 })).rejects.toThrow()
    const snapshot = await createVisit(doctor, postTerm.id, { ...measurement, requestId: randomUUID() })
    expect(snapshot.results.find(item => item.indicator === WhoIndicator.WEIGHT_FOR_AGE)).toMatchObject({ status: 'available', reference: { ageBasis: 'CHRONOLOGICAL', gestationDays: 294, prematurityDays: 0 } })
  }, 120000)

  it('retries a recalculation concurrently without duplicating results or altering a completed visit submission', async () => {
    const created = await createPatient(doctor, patientInput)
    const input = { ...measurement, requestId: randomUUID() }
    const original = await createVisit(doctor, created.id, input)
    const requestId = randomUUID()
    const [first, second] = await Promise.all([
      recalculateVisit(doctor, created.id, original.id, { requestId }),
      recalculateVisit(otherDoctor, created.id, original.id, { requestId })
    ])
    expect(first).toEqual(second)
    expect((await db.select().from(visitResult).where(eq(visitResult.visitId, original.id)))).toHaveLength(10)
    const retry = await createVisit(doctor, created.id, input)
    expect(retry.results).toEqual(original.results)
    expect((await getVisits(doctor, created.id))[0]?.results).toHaveLength(10)
  })

  it('rejects a recalculation request ID reused from a patient visit submission', async () => {
    const created = await createPatient(doctor, patientInput)
    const original = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID() })
    await expect(recalculateVisit(otherDoctor, created.id, original.id, { requestId: (await db.select().from(visit).where(eq(visit.id, original.id)))[0]!.requestId })).rejects.toThrow()
    expect((await db.select().from(visitResult).where(eq(visitResult.visitId, original.id)))).toHaveLength(5)
  })

  it('rejects malformed recalculation requests without appending results', async () => {
    const created = await createPatient(doctor, patientInput)
    const original = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID() })
    await expect(recalculateVisit(doctor, created.id, original.id, { requestId: 'invalid' })).rejects.toThrow()
    expect((await db.select().from(visitResult).where(eq(visitResult.visitId, original.id)))).toHaveLength(5)
  })

  it('does not accept a visit request ID reused for a prior recalculation', async () => {
    const created = await createPatient(doctor, patientInput)
    const first = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID() })
    const requestId = randomUUID()
    await recalculateVisit(doctor, created.id, first.id, { requestId })
    await expect(createVisit(doctor, created.id, { ...measurement, requestId, measuredAt: '2025-03-01T12:00:00.000Z' })).rejects.toThrow()
    expect((await db.select().from(visit).where(eq(visit.patientId, created.id)))).toHaveLength(1)
  })

  it('does not attach a previous recalculation to another patient with a reused request ID', async () => {
    const created = await createPatient(doctor, patientInput)
    const other = await createPatient(doctor, { ...patientInput, name: 'Segundo paciente' })
    const original = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID() })
    const second = await createVisit(doctor, other.id, { ...measurement, requestId: randomUUID() })
    const requestId = randomUUID()
    await recalculateVisit(doctor, created.id, original.id, { requestId })
    await expect(recalculateVisit(otherDoctor, other.id, second.id, { requestId })).rejects.toThrow()
    expect((await getVisits(doctor, other.id))[0]?.results).toHaveLength(5)
  })

  it('does not accept a recalculation request ID used for a different visit', async () => {
    const created = await createPatient(doctor, patientInput)
    const first = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID() })
    const second = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID(), measuredAt: '2025-03-01T12:00:00.000Z' })
    const requestId = randomUUID()
    await recalculateVisit(doctor, created.id, first.id, { requestId })
    await expect(recalculateVisit(doctor, created.id, second.id, { requestId })).rejects.toThrow()
    expect((await db.select().from(visitResult).where(eq(visitResult.visitId, second.id)))).toHaveLength(5)
  })

  it('denies recalculation for non-doctors and for a visit belonging to a different patient', async () => {
    const created = await createPatient(doctor, patientInput)
    const other = await createPatient(doctor, { ...patientInput, name: 'Otro paciente' })
    const original = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID() })
    for (const actor of [assistant, adminOnly, { id: randomUUID(), roles: ['PATIENT'] } as Actor]) {
      await expect(recalculateVisit(actor, created.id, original.id, { requestId: randomUUID() })).rejects.toThrow()
    }
    await expect(recalculateVisit(otherDoctor, other.id, original.id, { requestId: randomUUID() })).rejects.toThrow()
    await expect(recalculateVisit(otherDoctor, created.id, randomUUID(), { requestId: randomUUID() })).rejects.toThrow()
    expect((await db.select().from(visitResult).where(eq(visitResult.visitId, original.id)))).toHaveLength(5)
    expect((await db.select().from(auditEvent).where(eq(auditEvent.subjectId, created.id))).filter(event => event.action === 'CLINICAL_RECALCULATE' && event.outcome === 'DENIED')).toHaveLength(4)
  })

  it('uses the historical gestation and corrected-age setting when the patient record later changes', async () => {
    const created = await createPatient(doctor, { ...patientInput, birthDate: '2023-01-01' })
    const original = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID(), measuredAt: '2026-01-01T12:00:00.000Z', lengthHeightCm: 90 })
    await pool.query('UPDATE patient SET birth_date = $1, sex = $2, gestation_days = 280, correction_until_months = 24 WHERE id = $3', ['2023-02-01', Gender.MALE, created.id])
    await importRelease()
    const recalculated = await recalculateVisit(doctor, created.id, original.id, { requestId: randomUUID() })
    expect(recalculated.results.find(result => result.indicator === WhoIndicator.HEIGHT_FOR_AGE)).toMatchObject({ status: 'available', sex: Gender.FEMALE, reference: { ageBasis: 'CORRECTED', chronologicalAgeDays: 1096, gestationDays: 195, adjustmentCm: -0.7 } })
    expect(recalculated.results.some(result => result.indicator === WhoIndicator.WEIGHT_FOR_HEIGHT)).toBe(true)
    expect((await getVisits(doctor, created.id))[0]?.results.filter(result => result.parentResultId === null)).toHaveLength(5)
  }, 120000)

  it('preserves original position and snapshot when recalculated after a local-midnight correction boundary', async () => {
    const created = await createPatient(doctor, { ...patientInput, gestationDays: 196, correctionUntilMonths: 24 })
    const before = await createVisit(doctor, created.id, { ...measurement, measuredAt: '2026-01-02T04:59:59.000Z', lengthHeightCm: 85, position: 'STANDING', requestId: randomUUID() })
    await importRelease()
    const recalculated = await recalculateVisit(doctor, created.id, before.id, { requestId: randomUUID() })
    expect(recalculated.results.find(result => result.indicator === WhoIndicator.HEIGHT_FOR_AGE)).toMatchObject({ status: 'available', reference: { ageBasis: 'CORRECTED', referencePosition: 'RECUMBENT', adjustmentCm: 0.7, chronologicalAgeDays: 731 } })
    expect(recalculated.results.some(result => result.indicator === WhoIndicator.WEIGHT_FOR_LENGTH)).toBe(true)
    expect((await getVisits(doctor, created.id))[0]?.lengthHeightCm).toBe(85)
  }, 120000)

  it('recalculates the corrected-age 24-month leap boundary using the original visit position', async () => {
    const created = await createPatient(doctor, { ...patientInput, birthDate: '2024-02-29', gestationDays: 196, correctionUntilMonths: 24 })
    const input = { ...measurement, measuredAt: '2026-02-28T04:59:59.000Z', lengthHeightCm: 85, requestId: randomUUID() }
    const original = await createVisit(doctor, created.id, input)
    await importRelease()
    const recalculated = await recalculateVisit(doctor, created.id, original.id, { requestId: randomUUID() })
    const height = recalculated.results.find(result => result.indicator === WhoIndicator.HEIGHT_FOR_AGE)
    expect(height).toMatchObject({ status: 'available', reference: { ageBasis: 'CORRECTED', chronologicalAgeDays: 729, referencePosition: 'RECUMBENT' } })
    expect(recalculated.results.some(result => result.indicator === WhoIndicator.WEIGHT_FOR_LENGTH)).toBe(true)
  }, 120000)

  it('backfills historical birth date and sex on existing visits when the migration is applied', async () => {
    const created = await createPatient(doctor, patientInput)
    const original = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID() })
    expect((await db.select().from(visit).where(eq(visit.id, original.id)))[0]).toMatchObject({ birthDateAtVisit: birthDate, sexAtVisit: Gender.FEMALE })
  })

  it('does not recalculate from a partial or inconsistent original result set', async () => {
    const created = await createPatient(doctor, patientInput)
    const original = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID() })
    await pool.query('ALTER TABLE visit_result DISABLE TRIGGER USER')
    try {
      await pool.query('DELETE FROM visit_result WHERE visit_id = $1 AND indicator = $2', [original.id, WhoIndicator.BMI_FOR_AGE])
    } finally {
      await pool.query('ALTER TABLE visit_result ENABLE TRIGGER USER')
    }
    await expect(recalculateVisit(otherDoctor, created.id, original.id, { requestId: randomUUID() })).rejects.toThrow()
    expect((await db.select().from(visitResult).where(eq(visitResult.visitId, original.id)))).toHaveLength(4)
  })

  it('never appends fabricated available results for a five-year-old or an unsealed release', async () => {
    const created = await createPatient(doctor, { name: 'Mayor', birthDate: '2020-01-01', sex: Gender.MALE })
    const original = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00.000Z' })
    await importRelease()
    const recalculated = await recalculateVisit(doctor, created.id, original.id, { requestId: randomUUID() })
    expect(recalculated.results.every(result => result.status === 'unavailable')).toBe(true)
    expect(JSON.stringify(recalculated.results)).not.toContain('WHO_2006')
    expect((await getVisits(doctor, created.id))[0]?.results).toHaveLength(10)
  }, 120000)

  it('never reclassifies an original snapshot when a newer unapproved WHO version appears', async () => {
    const created = await createPatient(doctor, patientInput)
    const original = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID() })
    const result = original.results.find(item => item.indicator === WhoIndicator.WEIGHT_FOR_AGE)!
    expect(result.status).toBe('available')
    await pool.query(`INSERT INTO who_dataset (id,publisher,standard,version,publication_date,retrieved_at,source_url,sha256,indicator,sex,position,x_unit,min_x,max_x,row_count,sealed)
      SELECT $1,publisher,standard,$2,publication_date,retrieved_at,source_url,sha256,indicator,sex,position,x_unit,min_x,max_x,row_count,false
      FROM who_dataset WHERE id = $3`, [randomUUID(), 'PENDING_NEW_RELEASE', result.status === 'available' ? result.reference.datasetId : ''])
    expect((await getVisits(otherDoctor, created.id))[0]?.results.find(item => item.indicator === WhoIndicator.WEIGHT_FOR_AGE)).toEqual(result)
  })

  it('keeps corrected age and position provenance in persisted immutable WHO result snapshots', async () => {
    await importRelease()
    const created = await createPatient(doctor, { ...patientInput, birthDate: '2023-01-01' })
    const at36 = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID(), measuredAt: '2026-01-01T12:00:00.000Z', lengthHeightCm: 90 })
    const nextDay = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID(), measuredAt: '2026-01-02T12:00:00.000Z', lengthHeightCm: 90 })
    expect(at36.results.find(result => result.indicator === WhoIndicator.HEIGHT_FOR_AGE)).toMatchObject({ status: 'available', sex: Gender.FEMALE, reference: { ageBasis: 'CORRECTED', gestationDays: 195, position: 'RECUMBENT', adjustmentCm: -0.7 } })
    expect(nextDay.results.find(result => result.indicator === WhoIndicator.HEIGHT_FOR_AGE)).toMatchObject({ status: 'available', reference: { ageBasis: 'CHRONOLOGICAL' } })
    expect(at36.lengthHeightCm).toBe(90)
    expect(at36.bmi).toBeCloseTo(9 / (0.893 * 0.893))
    expect((await getVisits(otherDoctor, created.id)).map(row => row.id)).toEqual([nextDay.id, at36.id])
    expect((await db.select().from(auditEvent).where(eq(auditEvent.subjectId, created.id))).map(row => row.action)).toContain('CLINICAL_READ')
  }, 120000)

  it('keeps WHO-flagged measurement values but withholds only the affected indicator from shareable output', async () => {
    const newborn = await createPatient(doctor, { name: 'Medición para revisar', birthDate: '2024-01-01', sex: Gender.MALE })
    await importRelease()
    const saved = await createVisit(doctor, newborn.id, { ...measurement, weightKg: 20, lengthHeightCm: 50, headCircumferenceCm: 65, measuredAt: '2024-01-01T12:00:00.000Z', requestId: randomUUID() })
    const shared = shareableVisit((await getVisits(doctor, newborn.id))[0]!)
    expect(shared.weightKg).toBe(20)
    expect(shared.results.find(result => result.indicator === WhoIndicator.WEIGHT_FOR_AGE)).toMatchObject({ status: 'unavailable', reason: 'Verificar medidas con el profesional' })
    expect(JSON.stringify(shared)).not.toContain('Macrocefalia')
    expect(JSON.stringify(shared)).not.toContain('Obesidad')
    expect(saved.results.some(result => result.status === 'available')).toBe(true)
  }, 120000)

  it('never projects an unapproved result even when a caller fabricates a different result status', async () => {
    const created = await createPatient(doctor, patientInput)
    const original = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID() })
    const rerun = await recalculateVisit(doctor, created.id, original.id, { requestId: randomUUID() })
    const injected = { ...rerun.results[0]!, status: 'available', z: 1000, classification: { name: 'NO COMPARTIR', tone: 'flag' }, reference: { version: 'NO COMPARTIR' } }
    const projected = shareableVisit({ ...original, results: [...original.results, injected] } as typeof original)
    expect(projected.results).toHaveLength(5)
    expect(JSON.stringify(projected)).not.toContain('NO COMPARTIR')
  })

  it('never projects unapproved recalculation results to a future guardian or PDF', async () => {
    const created = await createPatient(doctor, patientInput)
    const original = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID() })
    const recalculated = await recalculateVisit(otherDoctor, created.id, original.id, { requestId: randomUUID() })
    const stored = (await getVisits(doctor, created.id))[0]!
    expect(stored.results).toHaveLength(10)
    const shareable = shareableVisit(stored)
    expect(shareable.results).toHaveLength(5)
    expect(shareable.results.map(result => result.id).toSorted()).toEqual(original.results.map(result => result.id).toSorted())
    expect(JSON.stringify(shareable)).not.toContain(recalculated.id)
    expect(JSON.stringify(shareable)).not.toContain(recalculated.results[0]!.id)
    expect(JSON.stringify(shareable)).not.toContain('Confidencial clínico')
    expect(JSON.stringify(shareable)).not.toContain('Seguimiento manual')
    expect(shareable.parentAdvice).toBe('Conversar en consulta')
  })

  it('excludes private notes from shareable snapshots and preserves doctor-only notes', async () => {
    const created = await createPatient(doctor, patientInput)
    const saved = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID() })
    const stored = (await getVisits(otherDoctor, created.id))[0]!
    expect(stored.privateNote).toBe('Confidencial clínico')
    expect(stored.clinicianTrend).toBe('Seguimiento manual')
    expect(stored.parentAdvice).toBe('Conversar en consulta')
    expect(JSON.stringify(shareableVisit(stored))).not.toContain('Confidencial clínico')
    expect(JSON.stringify(shareableVisit(stored))).not.toContain('Seguimiento manual')
    expect(JSON.stringify(shareableVisit(saved))).not.toContain('Confidencial clínico')
    expect(JSON.stringify(shareableVisit({ ...saved, futureConfidentialField: 'NO COMPARTIR' } as typeof saved))).not.toContain('NO COMPARTIR')
  })

  it('rejects updates and deletes of recalculated result snapshots too', async () => {
    const created = await createPatient(doctor, patientInput)
    const original = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID() })
    const recalculated = await recalculateVisit(doctor, created.id, original.id, { requestId: randomUUID() })
    const resultId = recalculated.results[0]!.id
    await expect(pool.query('UPDATE visit_result SET parent_result_id = NULL WHERE id = $1', [resultId])).rejects.toThrow()
    await expect(pool.query('DELETE FROM visit_result WHERE id = $1', [resultId])).rejects.toThrow()
    expect((await db.select().from(visitResult).where(eq(visitResult.id, resultId)))[0]?.parentResultId).toBe(original.results[0]?.id)
  })

  it('rejects mutation or deletion of committed base measurements and result snapshots', async () => {
    const created = await createPatient(doctor, patientInput)
    const saved = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID() })
    await expect(pool.query('UPDATE clinical_visit SET weight_kg = 30 WHERE id = $1', [saved.id])).rejects.toThrow()
    await expect(pool.query('DELETE FROM clinical_visit WHERE id = $1', [saved.id])).rejects.toThrow()
    await expect(pool.query('UPDATE visit_result SET snapshot = $1 WHERE visit_id = $2', ['{}', saved.id])).rejects.toThrow()
    await expect(pool.query('DELETE FROM visit_result WHERE visit_id = $1', [saved.id])).rejects.toThrow()
    expect((await getVisits(doctor, created.id))[0]?.weightKg).toBe(9)
  })

  it('keeps unrounded corrected Z and provenance on a male patient using female and male official rows', async () => {
    const male = await createPatient(doctor, { name: 'Niño Prueba', birthDate, sex: Gender.MALE })
    const female = await createPatient(doctor, { name: 'Niña Comparación', birthDate, sex: Gender.FEMALE })
    const input = { ...measurement, requestId: randomUUID() }
    const boy = await createVisit(doctor, male.id, input)
    const girl = await createVisit(doctor, female.id, { ...input, requestId: randomUUID() })
    const boyWeight = boy.results.find(result => result.indicator === WhoIndicator.WEIGHT_FOR_AGE)
    const girlWeight = girl.results.find(result => result.indicator === WhoIndicator.WEIGHT_FOR_AGE)
    expect(boyWeight).toMatchObject({ status: 'available', sex: Gender.MALE })
    expect(girlWeight).toMatchObject({ status: 'available', sex: Gender.FEMALE })
    expect(boyWeight?.status === 'available' && girlWeight?.status === 'available' && boyWeight.reference.datasetId !== girlWeight.reference.datasetId).toBe(true)
  })

  it('does not claim a reference before corrected birth even with approved WHO data', async () => {
    const created = await createPatient(doctor, patientInput)
    const snapshot = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID(), measuredAt: '2024-01-10T12:00:00.000Z', lengthHeightCm: 50, weightKg: 3, headCircumferenceCm: 35 })
    expect(snapshot.results.every(result => result.status === 'unavailable')).toBe(true)
  })

  it('keeps the day-730 position table on a leap-day anniversary with corrected age', async () => {
    const created = await createPatient(doctor, { ...patientInput, birthDate: '2024-02-29', gestationDays: 196, correctionUntilMonths: 24 })
    const snapshot = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID(), measuredAt: '2026-02-28T12:00:00.000Z', lengthHeightCm: 85 })
    expect(snapshot.results.find(result => result.indicator === WhoIndicator.WEIGHT_FOR_LENGTH)).toMatchObject({ status: 'available', reference: { ageBasis: 'CORRECTED', referencePosition: 'RECUMBENT' } })
  })

  it('switches 24 month correction by patient choice and never grants correction to term births', async () => {
    const premature = await createPatient(doctor, { ...patientInput, gestationDays: 196, correctionUntilMonths: 24 })
    const at24 = await createVisit(doctor, premature.id, { ...measurement, requestId: randomUUID(), measuredAt: '2026-01-01T12:00:00.000Z', lengthHeightCm: 85 })
    const after24 = await createVisit(doctor, premature.id, { ...measurement, requestId: randomUUID(), measuredAt: '2026-01-02T12:00:00.000Z', lengthHeightCm: 85 })
    expect(at24.results.find(result => result.indicator === WhoIndicator.HEIGHT_FOR_AGE)).toMatchObject({ status: 'available', reference: { ageBasis: 'CORRECTED', referencePosition: 'RECUMBENT' } })
    expect(after24.results.find(result => result.indicator === WhoIndicator.HEIGHT_FOR_AGE)).toMatchObject({ status: 'available', reference: { ageBasis: 'CHRONOLOGICAL', referencePosition: 'STANDING' } })
  })

  it('preserves the exact raw value of an independently validated extreme while withholding only its flagged indicator', async () => {
    const created = await createPatient(doctor, { name: 'Paciente extremo', birthDate: '2021-01-01', sex: Gender.FEMALE })
    await expect(createVisit(doctor, created.id, { ...measurement, requestId: randomUUID(), weightKg: 0.1, lengthHeightCm: 120 })).rejects.toThrow()
    await importRelease()
    const extreme = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID(), weightKg: 5, lengthHeightCm: 110, position: 'STANDING', measuredAt: '2025-12-01T12:00:00.000Z' })
    expect(extreme.weightKg).toBe(5)
    expect(extreme.results.find(result => result.indicator === WhoIndicator.WEIGHT_FOR_AGE)).toMatchObject({ status: 'unavailable', reason: 'Verificar medidas con el profesional' })
    expect(extreme.results.find(result => result.indicator === WhoIndicator.HEIGHT_FOR_AGE)?.status).toBe('available')
  })

  it('retains newborn measurements but withholds WHO-flagged indicators and accepts official unflagged extremes', async () => {
    const newborn = await createPatient(doctor, { name: 'Recién nacido', birthDate: '2024-01-01', sex: Gender.MALE })
    for (const invalid of [
      { weightKg: 250, lengthHeightCm: 50, headCircumferenceCm: 35 },
      { weightKg: 3.346, lengthHeightCm: 200, headCircumferenceCm: 35 },
      { weightKg: 3.346, lengthHeightCm: 50, headCircumferenceCm: 80 }
    ]) await expect(createVisit(doctor, newborn.id, { ...measurement, ...invalid, measuredAt: '2024-01-01T12:00:00.000Z', requestId: randomUUID() })).rejects.toThrow()
    expect(await db.select().from(visit).where(eq(visit.patientId, newborn.id))).toHaveLength(0)
    await importRelease()
    const implausible = await createVisit(doctor, newborn.id, { ...measurement, weightKg: 20, lengthHeightCm: 50, headCircumferenceCm: 65, measuredAt: '2024-01-01T12:00:00.000Z', requestId: randomUUID() })
    expect(implausible.weightKg).toBe(20)
    for (const indicator of [WhoIndicator.WEIGHT_FOR_AGE, WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE, WhoIndicator.BMI_FOR_AGE, WhoIndicator.WEIGHT_FOR_LENGTH]) {
      expect(implausible.results.find(result => result.indicator === indicator)).toMatchObject({ status: 'unavailable', reason: 'Verificar medidas con el profesional' })
    }
    expect(implausible.results.find(result => result.indicator === WhoIndicator.HEIGHT_FOR_AGE)?.status).toBe('available')
    const again = (await getVisits(doctor, newborn.id))[0]!
    expect(again.results.find(result => result.indicator === WhoIndicator.WEIGHT_FOR_AGE)).toMatchObject({ status: 'unavailable', reason: 'Verificar medidas con el profesional' })
    expect(JSON.stringify(shareableVisit(again))).not.toContain('Macrocefalia')
    const extreme = await createVisit(doctor, newborn.id, { ...measurement, weightKg: 2.048, lengthHeightCm: 45, headCircumferenceCm: 30, measuredAt: '2024-01-01T12:00:00.000Z', requestId: randomUUID() })
    expect(extreme.results.find(result => result.indicator === WhoIndicator.WEIGHT_FOR_AGE)).toMatchObject({ status: 'available', sex: Gender.MALE })
    expect(extreme.weightKg).toBe(2.048)
    expect((await getVisits(doctor, newborn.id))[0]?.results.filter(result => result.status === 'available').length).toBeGreaterThan(0)
  })

  it('rejects impossible dates and measures without storing partial visits', async () => {
    const created = await createPatient(doctor, patientInput)
    for (const invalid of [
      { weightKg: -2 }, { weightKg: 0 }, { lengthHeightCm: 12 }, { headCircumferenceCm: -1 },
      { position: 'UNKNOWN' }, { measuredAt: '2023-12-31T12:00:00Z' }, { measuredAt: 'bad' },
      { requestId: 'bad' }
    ]) await expect(createVisit(doctor, created.id, { ...measurement, requestId: randomUUID(), ...invalid } as typeof measurement)).rejects.toThrow()
    expect(await db.select().from(visit).where(eq(visit.patientId, created.id))).toHaveLength(0)
  })

  it('computes BMI from corrected recumbent length measured standing before two years', async () => {
    const created = await createPatient(doctor, { name: 'Bebé Prueba', birthDate, sex: Gender.MALE })
    const snapshot = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID(), position: 'STANDING', weightKg: 9, lengthHeightCm: 74.3 })
    expect(snapshot.bmi).toBeCloseTo(16)
    expect(snapshot.lengthHeightCm).toBe(74.3)
    expect(snapshot.results.find(item => item.indicator === WhoIndicator.BMI_FOR_AGE)).toMatchObject({ status: 'available', reference: { adjustmentCm: 0.7 } })
  })

  it('stores the measured BMI when the position already matches the selected table', async () => {
    const created = await createPatient(doctor, { name: 'Niño medido', birthDate: '2023-01-01', sex: Gender.MALE })
    const snapshot = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID(), measuredAt: '2026-01-01T12:00:00.000Z', position: 'STANDING', weightKg: 12, lengthHeightCm: 90 })
    expect(snapshot.bmi).toBeCloseTo(12 / 0.81)
    expect(snapshot.results.find(item => item.indicator === WhoIndicator.BMI_FOR_AGE)).toMatchObject({ status: 'available', reference: { adjustmentCm: 0 } })
  })

  it('returns one committed visit for simultaneous retries with the same request ID', async () => {
    const created = await createPatient(doctor, patientInput)
    const input = { ...measurement, requestId: randomUUID() }
    const [first, second] = await Promise.all([createVisit(doctor, created.id, input), createVisit(otherDoctor, created.id, input)])
    expect(second).toEqual(first)
    expect(await db.select().from(visit).where(eq(visit.patientId, created.id))).toHaveLength(1)
  })

  it('returns the same snapshot for retries but rejects a duplicate key with changed contents', async () => {
    const created = await createPatient(doctor, patientInput)
    const input = { ...measurement, requestId: randomUUID() }
    const first = await createVisit(doctor, created.id, input)
    expect(await createVisit(doctor, created.id, input)).toEqual(first)
    await expect(createVisit(doctor, created.id, { ...input, weightKg: 10 })).rejects.toThrow()
    expect(await db.select().from(visit).where(eq(visit.patientId, created.id))).toHaveLength(1)
  })

  it('does not include another visit private note in a shareable projection', async () => {
    const created = await createPatient(doctor, patientInput)
    const first = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID(), privateNote: 'NOTA PRIMERA' })
    const second = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID(), measuredAt: '2025-02-01T12:00:00.000Z', privateNote: 'NOTA SEGUNDA' })
    expect(JSON.stringify([shareableVisit(first), shareableVisit(second)])).not.toMatch(/NOTA PRIMERA|NOTA SEGUNDA/)
  })

  it('does not permit ADMIN plus ASSISTANT to escalate to doctor through role combination', async () => {
    const created = await createPatient(doctor, patientInput)
    const staff: Actor = { id: randomUUID(), roles: ['ADMIN', 'ASSISTANT'] }
    await expect(getPatient(staff, created.id)).rejects.toThrow()
    await expect(createVisit(staff, created.id, { ...measurement, requestId: randomUUID() })).rejects.toThrow()
    await expect(listPatients(staff, '')).rejects.toThrow()
  })

  it('denies patient and guardian identities even when they know an existing patient ID', async () => {
    const created = await createPatient(doctor, patientInput)
    const guardian: Actor = { id: randomUUID(), roles: ['PATIENT'] }
    await expect(getPatient(guardian, created.id)).rejects.toThrow()
    await expect(getVisits(guardian, created.id)).rejects.toThrow()
    await expect(listPatients(guardian, created.name)).rejects.toThrow()
    await expect(createVisit(guardian, created.id, { ...measurement, requestId: randomUUID() })).rejects.toThrow()
    const denied = await db.select().from(auditEvent).where(eq(auditEvent.subjectId, created.id))
    expect(denied.filter(event => event.outcome === 'DENIED')).toHaveLength(3)
  })

  it('does not change the original result or base value after a second visit is recorded', async () => {
    const created = await createPatient(doctor, patientInput)
    const first = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID() })
    await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID(), measuredAt: '2025-03-01T12:00:00.000Z', weightKg: 11 })
    const historic = (await getVisits(doctor, created.id))[1]!
    expect(historic.weightKg).toBe(9)
    expect(historic.results.toSorted((a, b) => a.indicator.localeCompare(b.indicator))).toEqual(first.results.toSorted((a, b) => a.indicator.localeCompare(b.indicator)))
  })

  it('does not compute WHO 2006 at exactly the fifth local birthday', async () => {
    const created = await createPatient(doctor, { name: 'Quinto cumpleaños', birthDate: '2020-01-01', sex: Gender.MALE })
    const before = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID(), measuredAt: '2025-01-01T04:59:59.000Z', position: 'STANDING', lengthHeightCm: 100 })
    const onBirthday = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID(), measuredAt: '2025-01-01T05:00:00.000Z', position: 'STANDING', lengthHeightCm: 100 })
    expect(before.results.find(item => item.indicator === WhoIndicator.HEIGHT_FOR_AGE)?.status).toBe('available')
    expect(onBirthday.results.every(item => item.status === 'unavailable')).toBe(true)
  })

  it('never computes 2006 results at or past the fifth birthday and denies trend writes by other roles', async () => {
    const created = await createPatient(doctor, { ...patientInput, birthDate: '2020-01-01' })
    const snapshot = await createVisit(doctor, created.id, { ...measurement, requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00.000Z' })
    expect(snapshot.results.every(result => result.status === 'unavailable')).toBe(true)
    expect(JSON.stringify(snapshot.results)).not.toContain('WHO_2006')
    await expect(createVisit(assistant, created.id, { ...measurement, requestId: randomUUID() })).rejects.toThrow()
    await expect(createVisit(adminOnly, created.id, { ...measurement, requestId: randomUUID() })).rejects.toThrow()
    expect(await getPatient(doctor, created.id)).toBeTruthy()
    await expect(getVisits(assistant, created.id)).rejects.toThrow()
    expect((await db.select().from(auditEvent).where(eq(auditEvent.subjectId, created.id))).map(row => row.outcome)).toContain('DENIED')
    expect(await db.select().from(patient).where(eq(patient.id, created.id))).toHaveLength(1)
  })
})
