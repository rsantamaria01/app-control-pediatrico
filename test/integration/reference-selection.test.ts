import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import manifest from '../../scripts/who-2006-manifest.json'
import { importWhoRelease, parseWhoWorkbook } from '../../server/services/who-import'
import { selectReference } from '../../server/services/reference-selection'
import { Gender, WhoIndicator } from '../../shared/utils/enums'
import type { VerifiedSource } from '../../shared/types/who'
import { correctZ } from '../../shared/utils/zscore'

const configured = process.env.WHO_TEST_DATABASE_URL
if (!configured || !['/pediatrico_who_slice3_test', '/pediatrico_who_slice3_verify', '/pediatrico_who_slice3_guard', '/pediatrico_who_slice3_sealed_test'].includes(new URL(configured).pathname) || configured === process.env.DATABASE_URL) throw new Error('Dedicated WHO test database required')
const name = `pediatrico_who_slice4_run_${randomUUID().replace(/-/g, '')}`
const target = new URL(configured)
target.pathname = `/${name}`
const admin = new URL(configured)
admin.pathname = '/postgres'
const adminPool = new Pool({ connectionString: admin.href })
const pool = new Pool({ connectionString: target.href })
const previous = process.env.DATABASE_URL
let created = false

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${name}"`)
  created = true
  process.env.DATABASE_URL = target.href
  await migrate(drizzle(pool), { migrationsFolder: './server/db/migrations' })
  await unavailable({ ...base })
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
      xUnit: isLength || isHeight ? 'CM' : 'DAY',
      minX: isLength ? 45 : isHeight ? 65 : 0,
      maxX: isLength ? 110 : isHeight ? 120 : 1856,
      step: isLength || isHeight ? 0.1 : 1
    }
    return { source, rows: await parseWhoWorkbook(source, bytes) }
  }))
  await importWhoRelease(entries)
}, 120000)

afterAll(async () => {
  process.env.DATABASE_URL = previous
  await pool.end()
  try {
    if (created) await adminPool.query(`DROP DATABASE "${name}"`)
  } finally {
    await adminPool.end()
  }
})

const birthDate = new Date('2024-01-01T00:00:00Z')
const at = (days: number) => new Date(birthDate.getTime() + days * 86400000 + 12 * 3600000)
const base = { birthDate, measuredAt: at(0), measuredLengthHeightCm: 50, position: 'RECUMBENT' as const, indicator: WhoIndicator.HEIGHT_FOR_AGE, sex: Gender.MALE }

async function available(input: Parameters<typeof selectReference>[0]) {
  const result = await selectReference(input)
  if ('unavailableReason' in result) throw new Error(result.unavailableReason)
  return result
}

async function unavailable(input: Parameters<typeof selectReference>[0]) {
  expect(await selectReference(input)).toHaveProperty('unavailableReason')
}

describe('sealed WHO release reference selection', () => {
  it('pins birth and day 730/731 to the exact dated sex and position dataset', async () => {
    for (const [day, position] of [[0, 'RECUMBENT'], [730, 'RECUMBENT'], [731, 'STANDING']] as const) {
      const result = await available({ ...base, measuredAt: at(day), measuredLengthHeightCm: day ? 85 : 50, position })
      expect(result).toMatchObject({ standard: 'WHO_2006', version: manifest.version, indicator: WhoIndicator.HEIGHT_FOR_AGE, sex: Gender.MALE, referencePosition: position, ageBasis: 'CHRONOLOGICAL', chronologicalAgeDays: day, referenceAgeDays: day, xUnit: 'DAY', x: day, adjustmentCm: 0 })
      expect(result.datasetId).toHaveLength(64)
      expect(result.lms.m).toBeGreaterThan(0)
    }
  })

  it('stops WHO 2006 at the fifth calendar birthday despite an existing day-1856 workbook row', async () => {
    const eligible = await available({ ...base, measuredAt: new Date('2028-12-31T17:00:00Z'), measuredLengthHeightCm: 105, position: 'STANDING' })
    expect(eligible).toMatchObject({ chronologicalAgeDays: 1826, x: 1826, referencePosition: 'STANDING' })
    const previousLocalEvening = await available({ ...base, measuredAt: new Date('2029-01-01T04:59:59Z'), measuredLengthHeightCm: 105, position: 'STANDING' })
    expect(previousLocalEvening).toMatchObject({ chronologicalAgeDays: 1826, x: 1826 })
    await unavailable({ ...base, measuredAt: new Date('2029-01-01T05:00:00Z'), measuredLengthHeightCm: 105, position: 'STANDING' })
    await unavailable({ ...base, measuredAt: at(1856), measuredLengthHeightCm: 105, position: 'STANDING' })
    await unavailable({ ...base, measuredAt: at(1857), measuredLengthHeightCm: 105, position: 'STANDING' })
  })

  it('uses fifth calendar birthdays for leap-day births and preserves sub-five day-count coverage', async () => {
    const leapBirth = new Date('2024-02-29T00:00:00Z')
    const before = await available({ ...base, birthDate: leapBirth, measuredAt: new Date('2029-02-27T17:00:00Z'), measuredLengthHeightCm: 105, position: 'STANDING' })
    expect(before).toMatchObject({ chronologicalAgeDays: 1825, x: 1825 })
    const finalEvening = await available({ ...base, birthDate: leapBirth, measuredAt: new Date('2029-02-28T04:59:59Z'), measuredLengthHeightCm: 105, position: 'STANDING' })
    expect(finalEvening).toMatchObject({ chronologicalAgeDays: 1825, x: 1825 })
    await unavailable({ ...base, birthDate: leapBirth, measuredAt: new Date('2029-02-28T05:00:00Z'), measuredLengthHeightCm: 105, position: 'STANDING' })
  })

  it('uses the clinic-local calendar day for a measurement instant and retains the original instant', async () => {
    const beforeMidnight = new Date('2024-01-03T04:59:59Z')
    const prior = await available({ ...base, measuredAt: beforeMidnight })
    expect(prior).toMatchObject({ measuredAt: beforeMidnight, chronologicalAgeDays: 1, referenceAgeDays: 1, x: 1 })
    const atMidnight = new Date('2024-01-03T05:00:00Z')
    const next = await available({ ...base, measuredAt: atMidnight })
    expect(next).toMatchObject({ measuredAt: atMidnight, chronologicalAgeDays: 2, referenceAgeDays: 2, x: 2 })
  })

  it('interprets birthDate as a date-only value, not as an instant shifted into the clinic zone', async () => {
    const instant = new Date('2024-01-01T05:00:00Z')
    const result = await available({ ...base, measuredAt: instant })
    expect(result).toMatchObject({ birthDate, measuredAt: instant, chronologicalAgeDays: 0, referenceAgeDays: 0, x: 0 })
    await unavailable({ ...base, measuredAt: new Date('2024-01-01T04:59:59Z') })
  })

  it('honors an explicitly selected IANA clinic zone rather than the deployment or process UTC zone', async () => {
    const instant = new Date('2024-01-03T04:30:00Z')
    const ecuador = await available({ ...base, measuredAt: instant })
    const newYork = await available({ ...base, measuredAt: instant, timeZone: 'America/New_York' })
    const tokyo = await available({ ...base, measuredAt: instant, timeZone: 'Asia/Tokyo' })
    expect(ecuador).toMatchObject({ chronologicalAgeDays: 1, x: 1, timeZone: 'America/Guayaquil' })
    expect(newYork).toMatchObject({ chronologicalAgeDays: 1, x: 1, timeZone: 'America/New_York' })
    expect(tokyo).toMatchObject({ chronologicalAgeDays: 2, x: 2, timeZone: 'Asia/Tokyo' })
  })

  it('chooses the 730/731 position table across clinic-local midnight, not UTC midnight', async () => {
    const before = await available({ ...base, measuredAt: new Date('2026-01-01T04:59:59Z'), measuredLengthHeightCm: 85, indicator: WhoIndicator.WEIGHT_FOR_LENGTH })
    expect(before).toMatchObject({ chronologicalAgeDays: 730, referenceAgeDays: 730, referencePosition: 'RECUMBENT', x: 85 })
    const after = await available({ ...base, measuredAt: new Date('2026-01-01T05:00:00Z'), measuredLengthHeightCm: 85, position: 'STANDING', indicator: WhoIndicator.WEIGHT_FOR_HEIGHT })
    expect(after).toMatchObject({ chronologicalAgeDays: 731, referenceAgeDays: 731, referencePosition: 'STANDING', x: 85 })
  })

  it('changes correction eligibility only at local midnight after the 24/36-month anniversaries', async () => {
    const corrected24 = await available({ ...base, measuredAt: new Date('2026-01-02T04:59:59Z'), gestationDays: 196, measuredLengthHeightCm: 85 })
    expect(corrected24).toMatchObject({ chronologicalAgeDays: 731, referenceAgeDays: 647, ageBasis: 'CORRECTED' })
    const expired24 = await available({ ...base, measuredAt: new Date('2026-01-02T05:00:00Z'), gestationDays: 196, measuredLengthHeightCm: 85 })
    expect(expired24).toMatchObject({ chronologicalAgeDays: 732, referenceAgeDays: 732, ageBasis: 'CHRONOLOGICAL' })
    const corrected36 = await available({ ...base, measuredAt: new Date('2027-01-02T04:59:59Z'), gestationDays: 195, correctionUntilMonths: 36, measuredLengthHeightCm: 90 })
    expect(corrected36).toMatchObject({ chronologicalAgeDays: 1096, referenceAgeDays: 1011, ageBasis: 'CORRECTED' })
    const expired36 = await available({ ...base, measuredAt: new Date('2027-01-02T05:00:00Z'), gestationDays: 195, correctionUntilMonths: 36, measuredLengthHeightCm: 90 })
    expect(expired36).toMatchObject({ chronologicalAgeDays: 1097, referenceAgeDays: 1097, ageBasis: 'CHRONOLOGICAL' })
  })

  it('counts leap day in local calendar age rather than truncating elapsed hours', async () => {
    const leapBirth = new Date('2024-02-28T00:00:00Z')
    const result = await available({ ...base, birthDate: leapBirth, measuredAt: new Date('2024-03-01T04:59:59Z') })
    expect(result).toMatchObject({ chronologicalAgeDays: 1, referenceAgeDays: 1, x: 1 })
    const next = await available({ ...base, birthDate: leapBirth, measuredAt: new Date('2024-03-01T05:00:00Z') })
    expect(next).toMatchObject({ chronologicalAgeDays: 2, referenceAgeDays: 2, x: 2 })
  })

  it('selects WFL before day 731 and WFH from day 731, never crossing position-specific x ranges', async () => {
    const before = await available({ ...base, measuredAt: at(730), indicator: WhoIndicator.WEIGHT_FOR_LENGTH, measuredLengthHeightCm: 85 })
    const after = await available({ ...base, measuredAt: at(731), indicator: WhoIndicator.WEIGHT_FOR_HEIGHT, position: 'STANDING', measuredLengthHeightCm: 85 })
    expect(before).toMatchObject({ x: 85, xUnit: 'CM', referencePosition: 'RECUMBENT' })
    expect(after).toMatchObject({ x: 85, xUnit: 'CM', referencePosition: 'STANDING' })
    expect(before.datasetId).not.toBe(after.datasetId)
    const lowerLength = await available({ ...base, measuredAt: at(730), indicator: WhoIndicator.WEIGHT_FOR_LENGTH, measuredLengthHeightCm: 45 })
    const upperLength = await available({ ...base, measuredAt: at(730), indicator: WhoIndicator.WEIGHT_FOR_LENGTH, measuredLengthHeightCm: 110 })
    const lowerHeight = await available({ ...base, measuredAt: at(731), indicator: WhoIndicator.WEIGHT_FOR_HEIGHT, position: 'STANDING', measuredLengthHeightCm: 65 })
    const upperHeight = await available({ ...base, measuredAt: at(731), indicator: WhoIndicator.WEIGHT_FOR_HEIGHT, position: 'STANDING', measuredLengthHeightCm: 120 })
    expect([lowerLength.x, upperLength.x, lowerHeight.x, upperHeight.x]).toEqual([45, 110, 65, 120])
    await unavailable({ ...base, measuredAt: at(730), indicator: WhoIndicator.WEIGHT_FOR_HEIGHT, measuredLengthHeightCm: 85 })
    await unavailable({ ...base, measuredAt: at(731), indicator: WhoIndicator.WEIGHT_FOR_LENGTH, measuredLengthHeightCm: 85 })
    await unavailable({ ...base, measuredAt: at(730), indicator: WhoIndicator.WEIGHT_FOR_LENGTH, measuredLengthHeightCm: 44.9 })
    await unavailable({ ...base, measuredAt: at(731), indicator: WhoIndicator.WEIGHT_FOR_HEIGHT, position: 'STANDING', measuredLengthHeightCm: 120.1 })
    const interpolated = await available({ ...base, measuredAt: at(731), indicator: WhoIndicator.WEIGHT_FOR_HEIGHT, position: 'STANDING', measuredLengthHeightCm: 85.05 })
    expect(interpolated).toMatchObject({ x: 85.05, xUnit: 'CM' })
    const lower = await available({ ...base, measuredAt: at(731), indicator: WhoIndicator.WEIGHT_FOR_HEIGHT, position: 'STANDING', measuredLengthHeightCm: 85 })
    const upper = await available({ ...base, measuredAt: at(731), indicator: WhoIndicator.WEIGHT_FOR_HEIGHT, position: 'STANDING', measuredLengthHeightCm: 85.1 })
    expect(interpolated.lms.m).toBeCloseTo((lower.lms.m + upper.lms.m) / 2, 8)
  })

  it('adjusts standing to recumbent +0.7 and recumbent to standing -0.7, retaining measured value and date', async () => {
    const young = await available({ ...base, measuredAt: at(365), measuredLengthHeightCm: 74.3, position: 'STANDING' })
    expect(young).toMatchObject({ measuredLengthHeightCm: 74.3, measuredAt: at(365), position: 'STANDING', referencePosition: 'RECUMBENT', adjustedLengthHeightCm: 75, adjustmentCm: 0.7, x: 365 })
    const older = await available({ ...base, measuredAt: at(900), measuredLengthHeightCm: 85.7 })
    expect(older).toMatchObject({ measuredLengthHeightCm: 85.7, measuredAt: at(900), position: 'RECUMBENT', referencePosition: 'STANDING', adjustedLengthHeightCm: 85, adjustmentCm: -0.7, x: 900 })
    const wh = await available({ ...base, measuredAt: at(900), indicator: WhoIndicator.WEIGHT_FOR_HEIGHT, measuredLengthHeightCm: 85.7 })
    expect(wh).toMatchObject({ x: 85, xUnit: 'CM', referencePosition: 'STANDING', adjustmentCm: -0.7 })
    expect(Math.abs(correctZ({ ...young.lms, value: 75 }) - (-0.31))).toBeLessThan(0.011)
    expect(Math.abs(correctZ({ ...older.lms, value: 85 }) - (-1.96))).toBeLessThan(0.011)
    expect(Math.abs(correctZ({ ...wh.lms, value: 12 }) - 0.34)).toBeLessThan(0.011)
    await unavailable({ ...base, measuredAt: at(900), indicator: WhoIndicator.WEIGHT_FOR_HEIGHT, measuredLengthHeightCm: 65 })
  })

  it('corrects gestational age until the chronological 24-month anniversary, or 36 only when selected for extreme prematurity', async () => {
    const before24 = new Date('2025-12-31T12:00:00Z')
    const at24 = new Date('2026-01-01T12:00:00Z')
    const at36 = new Date('2027-01-01T12:00:00Z')
    const after36 = new Date('2027-01-02T12:00:00Z')
    const corrected = await available({ ...base, measuredAt: before24, gestationDays: 196, measuredLengthHeightCm: 85 })
    expect(corrected).toMatchObject({ ageBasis: 'CORRECTED', gestationDays: 196, prematurityDays: 84, chronologicalAgeDays: 730, referenceAgeDays: 646, x: 646, referencePosition: 'RECUMBENT' })
    expect(Math.abs(correctZ({ ...corrected.lms, value: 85 }) - (-0.12))).toBeLessThan(0.011)
    const boundary = await available({ ...base, measuredAt: at24, gestationDays: 196, measuredLengthHeightCm: 85 })
    expect(boundary).toMatchObject({ ageBasis: 'CORRECTED', referenceAgeDays: 647, chronologicalAgeDays: 731, referencePosition: 'RECUMBENT' })
    expect(Math.abs(correctZ({ ...boundary.lms, value: 85 }) - (-0.13))).toBeLessThan(0.011)
    const correctedWfl = await available({ ...base, measuredAt: at24, gestationDays: 196, measuredLengthHeightCm: 85, indicator: WhoIndicator.WEIGHT_FOR_LENGTH })
    expect(correctedWfl).toMatchObject({ referenceAgeDays: 647, chronologicalAgeDays: 731, x: 85, xUnit: 'CM', referencePosition: 'RECUMBENT' })
    await unavailable({ ...base, measuredAt: at24, gestationDays: 196, measuredLengthHeightCm: 85, indicator: WhoIndicator.WEIGHT_FOR_HEIGHT })
    const expired = await available({ ...base, measuredAt: new Date('2026-01-02T12:00:00Z'), gestationDays: 196, measuredLengthHeightCm: 85 })
    expect(expired).toMatchObject({ ageBasis: 'CHRONOLOGICAL', referenceAgeDays: 732, referencePosition: 'STANDING' })
    const extended = await available({ ...base, measuredAt: at36, gestationDays: 195, correctionUntilMonths: 36, measuredLengthHeightCm: 90 })
    expect(extended).toMatchObject({ ageBasis: 'CORRECTED', gestationDays: 195, prematurityDays: 85, chronologicalAgeDays: 1096, referenceAgeDays: 1011, correctionUntilMonths: 36, referencePosition: 'STANDING', adjustedLengthHeightCm: 89.3 })
    expect(Math.abs(correctZ({ ...extended.lms, value: 89.3 }) - (-1.38))).toBeLessThan(0.011)
    const finished = await available({ ...base, measuredAt: after36, gestationDays: 195, correctionUntilMonths: 36, measuredLengthHeightCm: 90 })
    expect(finished).toMatchObject({ ageBasis: 'CHRONOLOGICAL', referenceAgeDays: 1097 })
    expect(Math.abs(correctZ({ ...finished.lms, value: 89.3 }) - (-1.84))).toBeLessThan(0.011)
    const term = await available({ ...base, measuredAt: at(365), gestationDays: 259, measuredLengthHeightCm: 75 })
    expect(term).toMatchObject({ ageBasis: 'CHRONOLOGICAL', prematurityDays: 0, referenceAgeDays: 365 })
    await unavailable({ ...base, measuredAt: at36, gestationDays: 196, correctionUntilMonths: 36 })
    await unavailable({ ...base, measuredAt: at36, correctionUntilMonths: 36 })
    await unavailable({ ...base, measuredAt: at(20), gestationDays: 195 })
  })

  it('returns unavailable when a release member is unsealed instead of falling back to another dataset', async () => {
    const selected = await available({ ...base, indicator: WhoIndicator.WEIGHT_FOR_AGE })
    await pool.query('ALTER TABLE who_dataset DISABLE TRIGGER USER')
    try {
      await pool.query('UPDATE who_dataset SET sealed = false WHERE id = $1', [selected.datasetId])
      await unavailable({ ...base, indicator: WhoIndicator.HEIGHT_FOR_AGE })
      await unavailable({ ...base, indicator: WhoIndicator.WEIGHT_FOR_AGE })
    } finally {
      await pool.query('UPDATE who_dataset SET sealed = true WHERE id = $1', [selected.datasetId])
      await pool.query('ALTER TABLE who_dataset ENABLE TRIGGER USER')
    }
  })

  it('cross-checks selected LMS with pinned WHO Anthro 1.1.0 sex-specific values without wrong-table fallback', async () => {
    for (const case_ of [
      { sex: Gender.MALE, day: 0, cm: 50, indicator: WhoIndicator.HEIGHT_FOR_AGE, value: 50, z: 0.06 },
      { sex: Gender.FEMALE, day: 730, cm: 85, indicator: WhoIndicator.HEIGHT_FOR_AGE, value: 85, z: -0.43 },
      { sex: Gender.MALE, day: 731, cm: 85, indicator: WhoIndicator.HEIGHT_FOR_AGE, value: 85, z: -0.70 },
      { sex: Gender.MALE, day: 731, cm: 85, indicator: WhoIndicator.WEIGHT_FOR_HEIGHT, value: 12, z: 0.34 },
      { sex: Gender.FEMALE, day: 730, cm: 85, indicator: WhoIndicator.WEIGHT_FOR_LENGTH, value: 12, z: 0.75 },
      { sex: Gender.FEMALE, day: 1800, cm: 110, indicator: WhoIndicator.WEIGHT_FOR_AGE, value: 5, z: -7.17 }
    ]) {
      const result = await available({ ...base, measuredAt: at(case_.day), sex: case_.sex, indicator: case_.indicator, measuredLengthHeightCm: case_.cm, position: case_.day > 730 ? 'STANDING' : 'RECUMBENT' })
      expect(Math.abs(correctZ({ ...result.lms, value: case_.value }) - case_.z)).toBeLessThan(0.011)
      expect(result.sex).toBe(case_.sex)
    }
  })

  it('fails closed for a mismatched sex and keeps the complete release immutable', async () => {
    const result = await available({ ...base, indicator: WhoIndicator.WEIGHT_FOR_AGE })
    expect(result.datasetId).toHaveLength(64)
    expect(result).toMatchObject({ referencePosition: null, xUnit: 'DAY', x: 0 })
    await expect(pool.query('UPDATE who_dataset SET sealed = false WHERE id = $1', [result.datasetId])).rejects.toThrow()
    await unavailable({ ...base, sex: 'OTHER' as Gender })
  })
})
