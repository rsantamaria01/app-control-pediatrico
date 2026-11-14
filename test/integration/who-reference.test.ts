import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { count, eq } from 'drizzle-orm'
import { Pool } from 'pg'
import manifest from '../../scripts/who-2006-manifest.json'
import { importWhoDataset, getWhoRows, parseWhoWorkbook, validateWhoDataset } from '../../server/services/who-import'
import { whoDataset, whoReferenceRow } from '../../server/db/schema'
import { Gender, WhoIndicator } from '../../shared/utils/enums'
import type { DatasetId, VerifiedSource, WhoRow } from '../../shared/types/who'
import { correctZ } from '../../shared/utils/zscore'

const url = process.env.WHO_TEST_DATABASE_URL
if (!url || !['/pediatrico_who_slice3_test', '/pediatrico_who_slice3_verify', '/pediatrico_who_slice3_guard'].includes(new URL(url).pathname) || url === process.env.DATABASE_URL) throw new Error('Dedicated WHO test database required')
process.env.DATABASE_URL = url
const pool = new Pool({ connectionString: url })
const db = drizzle(pool)
const datasets = new Map<string, { id: DatasetId, rows: WhoRow[] }>()

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './server/db/migrations' })
}, 120000)
afterAll(async () => pool.end())

function metadata(file: typeof manifest.files[number], bytes: Uint8Array): VerifiedSource {
  const indicator = file.indicator as WhoIndicator
  const isLength = indicator === WhoIndicator.WEIGHT_FOR_LENGTH
  const isHeight = indicator === WhoIndicator.WEIGHT_FOR_HEIGHT
  return {
    publisher: 'WHO', standard: 'WHO_2006', version: manifest.version,
    publicationDate: file.publicationDate, retrievedAt: manifest.retrievedAt,
    url: file.url, sha256: file.sha256, bytes, indicator, sex: file.sex as Gender,
    position: isLength ? 'RECUMBENT' : isHeight ? 'STANDING' : null,
    xUnit: isLength || isHeight ? 'CM' : 'DAY',
    minX: isLength ? 45 : isHeight ? 65 : 0, maxX: isLength ? 110 : isHeight ? 120 : 1856,
    step: isLength || isHeight ? 0.1 : 1
  }
}

describe('pinned WHO 2006 originals', () => {
  it('imports all six categories for both sexes with source counts and ordered SD rows', async () => {
    for (const file of manifest.files) {
      const bytes = await readFile(resolve('/tmp/opencode/who-2006', `${file.name}-expanded.xlsx`))
      const source = metadata(file, bytes)
      const rows = await parseWhoWorkbook(source, bytes)
      expect(rows).toHaveLength(source.xUnit === 'DAY' ? 1857 : source.position === 'RECUMBENT' ? 651 : 551)
      const existing = await db.select({ id: whoDataset.id }).from(whoDataset).where(eq(whoDataset.sha256, file.sha256))
      const id = existing.length ? existing[0]!.id as DatasetId : await importWhoDataset(source, rows)
      datasets.set(file.name, { id, rows })
      const returned = await getWhoRows(id, source.indicator, source.sex, source.position === null && source.indicator === WhoIndicator.HEIGHT_FOR_AGE ? 'RECUMBENT' : source.position)
      expect(returned.length).toBe(source.indicator === WhoIndicator.HEIGHT_FOR_AGE ? 731 : rows.length)
      expect(returned[0]!.sdNeg3).toBe(rows[0]!.sdNeg3)
      expect(returned.at(-1)!.x).toBe(source.indicator === WhoIndicator.HEIGHT_FOR_AGE ? 730 : source.maxX)
      if (source.indicator === WhoIndicator.HEIGHT_FOR_AGE) {
        const standing = await getWhoRows(id, source.indicator, source.sex, 'STANDING')
        expect(standing).toHaveLength(1126)
        expect(standing[0]!.x).toBe(731)
        expect(standing[0]!.m).toBe(rows[731]!.m)
      }
      expect(await getWhoRows(id, source.indicator, source.sex === Gender.MALE ? Gender.FEMALE : Gender.MALE, source.position)).toEqual([])
    }
    expect(datasets.size).toBe(12)
    expect((await db.select({ count: count() }).from(whoReferenceRow))[0]!.count).toBe(1857 * 8 + 651 * 2 + 551 * 2)
  }, 120000)

  it('never overwrites a published version and DB rejects duplicate or invalid SD rows', async () => {
    const file = manifest.files[0]!
    const bytes = await readFile(resolve('/tmp/opencode/who-2006', `${file.name}-expanded.xlsx`))
    const source = metadata(file, bytes)
    const { id, rows } = datasets.get(file.name)!
    await expect(importWhoDataset(source, rows)).rejects.toThrow()
    await expect(importWhoDataset({ ...source, version: 'WHO_2006_CHANGED' }, rows)).rejects.toThrow()
    await expect(importWhoDataset(source, [{ ...rows[0]!, m: 99 }, ...rows.slice(1)])).rejects.toThrow()
    await expect(db.insert(whoReferenceRow).values({ datasetId: id, ...rows[0]!, x: '0', l: '1', m: '1', s: '1', sdNeg3: '1', sdNeg2: '2', sdNeg1: '3', sd0: '4', sd1: '5', sd2: '6', sd3: '7' })).rejects.toThrow()
    await expect(db.insert(whoReferenceRow).values({ datasetId: id, ...rows[0]!, x: '2000', l: '1', m: '-1', s: '1', sdNeg3: '1', sdNeg2: '2', sdNeg1: '3', sd0: '4', sd1: '5', sd2: '6', sd3: '7' })).rejects.toThrow()
    await expect(db.insert(whoReferenceRow).values({ datasetId: id, ...rows[0]!, x: '2000', sex: Gender.FEMALE, l: '1', m: '1', s: '1', sdNeg3: '1', sdNeg2: '2', sdNeg1: '3', sd0: '4', sd1: '5', sd2: '6', sd3: '7' })).rejects.toThrow()
    await expect(db.update(whoReferenceRow).set({ m: '99' }).where(eq(whoReferenceRow.datasetId, id))).rejects.toThrow()
    await expect(db.delete(whoDataset).where(eq(whoDataset.id, id))).rejects.toThrow()
    expect((await getWhoRows(id, source.indicator, source.sex, null))[0]!.m).toBe(rows[0]!.m)
  })

  it('rejects metadata changes and corrupted pinned workbook bytes without writing', async () => {
    const file = manifest.files[0]!
    const bytes = await readFile(resolve('/tmp/opencode/who-2006', `${file.name}-expanded.xlsx`))
    const source = metadata(file, bytes)
    const rows = datasets.get(file.name)!.rows
    for (const change of [{ version: '' }, { version: 'WHO_2006_OTHER' }, { publicationDate: '' }, { retrievedAt: '' }, { sha256: '0'.repeat(64) }, { publisher: 'other' }, { url: 'https://evil.example/test.xlsx' }]) {
      expect(() => validateWhoDataset({ ...source, ...change } as VerifiedSource, rows)).toThrow()
    }
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1
    await expect(parseWhoWorkbook(source, bytes)).rejects.toThrow('hash mismatch')
  })

  it('compares independent WHO anthro z-score fixtures for all indicators and both sexes including tails', () => {
    const fixtures = [
      { sex: 'boys', day: 0, length: 50, weight: 3.5, head: 34, zlen: 0.06, zwei: 0.31, zwfl: 0.56, zbmi: 0.45, zhc: -0.36 },
      { sex: 'girls', day: 30, length: 53, weight: 4, head: 37, zlen: -0.32, zwei: -0.30, zwfl: -0.09, zbmi: -0.22, zhc: 0.41 },
      { sex: 'boys', day: 365, length: 75, weight: 9, head: 45, zlen: -0.31, zwei: -0.63, zwfl: -0.66, zbmi: -0.61, zhc: -0.83 },
      { sex: 'girls', day: 730, length: 85, weight: 12, head: 47, zlen: -0.43, zwei: 0.36, zwfl: 0.75, zbmi: 0.86, zhc: -0.13 },
      { sex: 'boys', day: 731, length: 85, weight: 12, head: 47, zlen: -0.70, zwei: -0.11, zwfl: 0.34, zbmi: 0.46, zhc: -0.92 },
      { sex: 'girls', day: 900, length: 90, weight: 12, head: 48, zlen: -0.10, zwei: -0.40, zwfl: -0.59, zbmi: -0.57, zhc: 0.08 },
      { sex: 'boys', day: 1500, length: 105, weight: 18, head: 50, zlen: 0.22, zwei: 0.65, zwfl: 0.77, zbmi: 0.76, zhc: -0.19 },
      { sex: 'girls', day: 1800, length: 110, weight: 5, head: 40, zlen: 0.22, zwei: -7.17, zwfl: -10.18, zbmi: -10.21, zhc: -6.95 },
      { sex: 'boys', day: 365, length: 75, weight: 22, head: 53, zlen: -0.31, zwei: 9.38, zwfl: 12.16, zbmi: 12.66, zhc: 5.40 },
      { sex: 'girls', day: 900, length: 90, weight: 25, head: 55, zlen: -0.10, zwei: 5.51, zwfl: 8.29, zbmi: 8.59, zhc: 5.06 }
    ]
    for (const case_ of fixtures) {
      const lookup = (name: string, x: number) => datasets.get(`${name}-${case_.sex}`)!.rows.find(row => Math.abs(row.x - x) < 0.00001)!
      const computed = (row: WhoRow, value: number) => correctZ({ value, l: row.l, m: row.m, s: row.s })
      expect(Math.abs(computed(lookup('lhfa', case_.day), case_.length) - case_.zlen)).toBeLessThan(0.011)
      expect(Math.abs(computed(lookup('wfa', case_.day), case_.weight) - case_.zwei)).toBeLessThan(0.011)
      expect(Math.abs(computed(lookup(case_.day <= 730 ? 'wfl' : 'wfh', case_.length), case_.weight) - case_.zwfl)).toBeLessThan(0.011)
      expect(Math.abs(computed(lookup('bfa', case_.day), case_.weight / (case_.length / 100) ** 2) - case_.zbmi)).toBeLessThan(0.011)
      expect(Math.abs(computed(lookup('hcfa', case_.day), case_.head) - case_.zhc)).toBeLessThan(0.011)
    }
  })
})
