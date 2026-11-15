import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { eq, isNull } from 'drizzle-orm'
import type { Actor } from '../../shared/types/access'
import { patient, visit, visitResult } from '../../server/db/schema'
import { evaluateGrowthReview, listGrowthReview } from '../../server/services/growth-review'

type Reading = { measuredAt: string, indicator: string, z: number | null, reference: string, ageBasis: string }
const reading = (day: number, z: number | null, indicator = 'WEIGHT_FOR_AGE', reference = 'WHO2006', ageBasis = 'CHRONOLOGICAL'): Reading => ({ measuredAt: `2026-01-${String(day).padStart(2, '0')}T12:00:00Z`, indicator, z, reference, ageBasis })

describe('doctor growth review membership', () => {
  it('uses strict raw Z boundaries and configurable threshold', () => {
    expect(evaluateGrowthReview([reading(1, 2), reading(29, 2)])).toEqual([])
    expect(evaluateGrowthReview([reading(29, -2)])).toEqual([])
    expect(evaluateGrowthReview([reading(1, 0), reading(29, 2.0001)])).toContain('WEIGHT_FOR_AGE')
    expect(evaluateGrowthReview([reading(1, 0), reading(29, -2.0001)])).toContain('WEIGHT_FOR_AGE')
    expect(evaluateGrowthReview([reading(1, 0), reading(29, 2.1)], { outsideZ: 2.2, deltaZ: 3, minDays: 28 })).toEqual([])
  })

  it('compares latest two comparable visits at the four-week boundary and includes equality at delta 1', () => {
    expect(evaluateGrowthReview([reading(1, 0), reading(29, 1)])).toContain('WEIGHT_FOR_AGE')
    expect(evaluateGrowthReview([reading(2, 0), reading(29, 1)])).toEqual([])
    expect(evaluateGrowthReview([reading(1, 0), reading(29, 1)], { outsideZ: 2, deltaZ: 1.1, minDays: 28 })).toEqual([])
    expect(evaluateGrowthReview([reading(1, 0), reading(29, 1), reading(30, 1.1)])).toContain('WEIGHT_FOR_AGE')
    expect(evaluateGrowthReview([reading(1, 0), reading(15, 0.4), reading(29, 1)])).toContain('WEIGHT_FOR_AGE')
  })

  it('never fills missing references or compares different indicator, version, or age basis', () => {
    expect(evaluateGrowthReview([reading(1, 0), reading(29, null)])).toEqual([])
    expect(evaluateGrowthReview([reading(1, 0), reading(29, 1, 'WEIGHT_FOR_AGE', '')])).toEqual([])
    expect(evaluateGrowthReview([reading(1, 0), reading(29, 1), reading(30, null)])).toEqual([])
    expect(evaluateGrowthReview([reading(1, 0), reading(29, null), reading(30, 1.1)])).toContain('WEIGHT_FOR_AGE')
    expect(evaluateGrowthReview([reading(1, 0), reading(29, 1, 'BMI_FOR_AGE')])).toEqual([])
    expect(evaluateGrowthReview([reading(1, 0), reading(29, 1, 'WEIGHT_FOR_AGE', 'WHO2007')])).toEqual([])
    expect(evaluateGrowthReview([reading(1, 0), reading(29, 1, 'WEIGHT_FOR_AGE', 'WHO2006', 'CORRECTED')])).toEqual([])
  })
})

const configured = process.env.WHO_TEST_DATABASE_URL
if (!configured || !['/pediatrico_who_slice3_test', '/pediatrico_who_slice3_verify', '/pediatrico_who_slice3_guard', '/pediatrico_who_slice3_sealed_test'].includes(new URL(configured).pathname) || configured === process.env.DATABASE_URL) throw new Error('Dedicated WHO test database required')
const name = `pediatrico_review_${randomUUID().replace(/-/g, '')}`
const target = new URL(configured)
target.pathname = `/${name}`
const admin = new URL(configured)
admin.pathname = '/postgres'
const adminPool = new Pool({ connectionString: admin.href })
const pool = new Pool({ connectionString: target.href })
const db = drizzle(pool)
const previous = process.env.DATABASE_URL
const doctor: Actor = { id: randomUUID(), roles: ['DOCTOR'] }
const assistant: Actor = { id: randomUUID(), roles: ['ASSISTANT'] }
const personId = randomUUID()
let created = false

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

it('projects the newest audited recalculation for each visit and indicator without changing original snapshots', async () => {
  await db.insert(patient).values({ id: personId, name: 'Niña revisión', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
  const visits = [new Date('2026-01-01T12:00:00Z'), new Date('2026-01-29T12:00:00Z')]
  const ids = [randomUUID(), randomUUID()]
  for (const [index, measuredAt] of visits.entries()) {
    await db.insert(visit).values({ id: ids[index]!, patientId: personId, requestId: randomUUID(), requestDigest: 'fixture', measuredAt, weightKg: '10', lengthHeightCm: '80', position: 'STANDING', headCircumferenceCm: '45', bmi: '15', birthDateAtVisit: '2024-01-01', sexAtVisit: 'FEMALE', correctionUntilMonths: 24, authorId: doctor.id })
    await db.insert(visitResult).values({ id: randomUUID(), visitId: ids[index]!, indicator: 'WEIGHT_FOR_AGE', snapshot: { status: 'available', z: 0, reference: { version: 'WHO2006', datasetId: 'sealed', ageBasis: 'CHRONOLOGICAL' } }, calculatedBy: doctor.id })
  }
  expect(await listGrowthReview(doctor)).toEqual([])
  await expect(listGrowthReview(assistant)).rejects.toMatchObject({ statusCode: 403 })
  const recalculation = randomUUID()
  await db.insert(visitResult).values({ id: randomUUID(), visitId: ids[1]!, indicator: 'WEIGHT_FOR_AGE', snapshot: { status: 'available', z: 1, reference: { version: 'WHO2006', datasetId: 'sealed', ageBasis: 'CHRONOLOGICAL' } }, recalculationId: recalculation, calculatedBy: doctor.id, createdAt: new Date('2030-02-01T12:00:00Z') })
  expect(await listGrowthReview(doctor)).toEqual([{ id: personId, name: 'Niña revisión', indicators: ['WEIGHT_FOR_AGE'] }])
  const [original] = await db.select().from(visitResult).where(eq(visitResult.visitId, ids[1]!)).orderBy(visitResult.createdAt).limit(1)
  expect(original?.snapshot).toMatchObject({ status: 'available', z: 0 })
  expect((await db.select().from(visitResult).where(isNull(visitResult.recalculationId))).filter(row => ids.includes(row.visitId))).toHaveLength(2)
  await db.insert(visitResult).values({ id: randomUUID(), visitId: ids[1]!, indicator: 'WEIGHT_FOR_AGE', snapshot: { status: 'available', z: 0.5, reference: { version: 'WHO2006', datasetId: 'sealed', ageBasis: 'CHRONOLOGICAL' } }, recalculationId: randomUUID(), calculatedBy: doctor.id, createdAt: new Date('2030-02-02T12:00:00Z') })
  expect(await listGrowthReview(doctor)).toEqual([])
  await db.insert(visitResult).values({ id: randomUUID(), visitId: ids[1]!, indicator: 'WEIGHT_FOR_AGE', snapshot: { status: 'unavailable', reason: 'Referencia ausente' }, recalculationId: randomUUID(), calculatedBy: doctor.id, createdAt: new Date('2030-02-03T12:00:00Z') })
  expect(await listGrowthReview(doctor)).toEqual([])
})
