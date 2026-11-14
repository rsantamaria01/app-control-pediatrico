import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { readFile, copyFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { count, eq } from 'drizzle-orm'
import { execFileSync } from 'node:child_process'
import { Pool } from 'pg'
import manifest from '../../scripts/who-2006-manifest.json'
import { importWhoDataset, importWhoRelease, getWhoRows, parseWhoWorkbook, validateWhoDataset } from '../../server/services/who-import'
import { whoDataset, whoReferenceRow } from '../../server/db/schema'
import { Gender, WhoIndicator } from '../../shared/utils/enums'
import type { DatasetId, VerifiedSource, WhoRow } from '../../shared/types/who'
import { correctZ } from '../../shared/utils/zscore'

const configuredUrl = process.env.WHO_TEST_DATABASE_URL
if (!configuredUrl || !['/pediatrico_who_slice3_test', '/pediatrico_who_slice3_verify', '/pediatrico_who_slice3_guard', '/pediatrico_who_slice3_sealed_test'].includes(new URL(configuredUrl).pathname) || configuredUrl === process.env.DATABASE_URL) throw new Error('Dedicated WHO test database required')
const databaseName = `pediatrico_who_slice3_run_${randomUUID().replace(/-/g, '')}`
const testUrl = new URL(configuredUrl)
testUrl.pathname = `/${databaseName}`
const url = testUrl.href
const adminUrl = new URL(configuredUrl)
adminUrl.pathname = '/postgres'
const adminPool = new Pool({ connectionString: adminUrl.href })
process.env.DATABASE_URL = url
const pool = new Pool({ connectionString: url })
const db = drizzle(pool)
const datasets = new Map<string, { id: DatasetId, rows: WhoRow[] }>()
let created = false

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${databaseName}"`)
  created = true
  await migrate(db, { migrationsFolder: './server/db/migrations' })
  expect((await db.select({ count: count() }).from(whoDataset))[0]!.count).toBe(0)
  const entries = await Promise.all(manifest.files.map(async (file) => {
    const bytes = await readFile(resolve('/tmp/opencode/who-2006', `${file.name}-expanded.xlsx`))
    const source = metadata(file, bytes)
    const rows = await parseWhoWorkbook(source, bytes)
    datasets.set(file.name, { id: '' as DatasetId, rows })
    return { source, rows }
  }))
  const ids = await importWhoRelease(entries)
  for (const [index, file] of manifest.files.entries()) datasets.get(file.name)!.id = ids[index]!
}, 120000)
afterAll(async () => {
  await pool.end()
  try {
    if (created) await adminPool.query(`DROP DATABASE "${databaseName}"`)
  } finally {
    await adminPool.end()
  }
})

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
  it('reads all six categories for both sexes after one atomic import with source counts and ordered SD rows', async () => {
    for (const file of manifest.files) {
      const { id, rows } = datasets.get(file.name)!
      const source = metadata(file, await readFile(resolve('/tmp/opencode/who-2006', `${file.name}-expanded.xlsx`)))
      expect(rows).toHaveLength(source.xUnit === 'DAY' ? 1857 : source.position === 'RECUMBENT' ? 651 : 551)
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
    expect((await db.select({ count: count() }).from(whoReferenceRow).innerJoin(whoDataset, eq(whoReferenceRow.datasetId, whoDataset.id)).where(eq(whoDataset.version, manifest.version)))[0]!.count).toBe(1857 * 8 + 651 * 2 + 551 * 2)
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

  it('never adds plausible extra rows to a sealed dataset', async () => {
    const [dataset] = await db.select().from(whoDataset).where(eq(whoDataset.indicator, 'WEIGHT_FOR_LENGTH'))
    expect(dataset?.sealed).toBe(true)
    await expect(pool.query(`INSERT INTO who_reference_row (dataset_id, indicator, sex, position, x_unit, x, l, m, s, sd_neg3, sd_neg2, sd_neg1, sd_0, sd_1, sd_2, sd_3) VALUES ($1, 'WEIGHT_FOR_LENGTH', 'MALE', 'RECUMBENT', 'CM', 45.1, 1, 3, 0.1, 1, 2, 2.5, 3, 3.5, 4, 5) ON CONFLICT DO NOTHING`, [dataset!.id])).rejects.toThrow('sealed')
    expect((await pool.query('SELECT count(*)::int AS n FROM who_reference_row WHERE dataset_id = $1', [dataset!.id])).rows[0].n).toBe(651)
  })

  it('requires explicit approval even when WHO_TEST_DATABASE_URL points to a disposable database', async () => {
    const cli = resolve('node_modules/.bin/tsx')
    try {
      execFileSync(cli, ['scripts/import-who.ts', 'import'], {
        env: { ...process.env, DATABASE_URL: url!, WHO_TEST_DATABASE_URL: url!, WHO_ALLOW_CLINICAL_IMPORT: undefined },
        encoding: 'utf8', stdio: 'pipe'
      })
      throw new Error('CLI unexpectedly imported without approval')
    } catch (error) {
      expect((error as { stderr: string }).stderr).toContain('Explicit WHO import approval required')
    }
  })

  it('refuses any database by default, including a renamed production database', async () => {
    const cli = resolve('node_modules/.bin/tsx')
    const run = (databaseUrl: string, approval?: string) => execFileSync(cli, ['scripts/import-who.ts', 'import'], {
      env: { ...process.env, DATABASE_URL: databaseUrl, WHO_ALLOW_CLINICAL_IMPORT: approval, WHO_SOURCE_DIR: '/tmp/opencode/who-2006' },
      encoding: 'utf8', stdio: 'pipe'
    })
    const renamed = new URL(url!)
    renamed.pathname = '/renamed_clinic_production'
    for (const databaseUrl of [renamed.href, url!]) {
      try {
        run(databaseUrl)
        throw new Error('CLI unexpectedly allowed import')
      } catch (error) {
        expect((error as { stderr: string }).stderr).toContain('Explicit WHO import approval required')
      }
    }
    expect((await db.select({ count: count() }).from(whoDataset).where(eq(whoDataset.version, manifest.version)))[0]!.count).toBe(12)
  })

  it('refuses rows for an unsealed dataset and cannot seal before expected rows exist', async () => {
    const file = manifest.files[0]!
    const bytes = await readFile(resolve('/tmp/opencode/who-2006', `${file.name}-expanded.xlsx`))
    const source = metadata(file, bytes)
    const rows = await parseWhoWorkbook(source, bytes)
    const id = randomUUID() as DatasetId
    await db.insert(whoDataset).values({ id, publisher: source.publisher, standard: source.standard,
      version: `${source.version}_unsealed_${id}`, publicationDate: source.publicationDate, retrievedAt: source.retrievedAt,
      sourceUrl: `${source.url}&test=${id}`, sha256: source.sha256, indicator: source.indicator,
      sex: source.sex, position: source.position, xUnit: source.xUnit, minX: '0', maxX: '1856', rowCount: rows.length })
    expect(await getWhoRows(id, source.indicator, source.sex, null)).toEqual([])
    await expect(pool.query('UPDATE who_dataset SET sealed = true WHERE id = $1', [id])).rejects.toThrow('incomplete')
    expect(await getWhoRows(id, source.indicator, source.sex, null)).toEqual([])
  })

  it('verifies a previously imported dataset and resumes a complete release without overwriting rows', async () => {
    const entries = await Promise.all(manifest.files.map(async (file) => {
      const bytes = await readFile(resolve('/tmp/opencode/who-2006', `${file.name}-expanded.xlsx`))
      const source = metadata(file, bytes)
      return { source, rows: await parseWhoWorkbook(source, bytes) }
    }))
    const before = (await db.select({ count: count() }).from(whoReferenceRow))[0]!.count
    await expect(importWhoRelease(entries)).resolves.toHaveLength(12)
    expect((await db.select({ count: count() }).from(whoReferenceRow))[0]!.count).toBe(before)
    expect((await db.select({ count: count() }).from(whoDataset).where(eq(whoDataset.version, manifest.version)))[0]!.count).toBe(12)
  })

  it('keeps one imported workbook unavailable until the release is complete', async () => {
    const admin = new Pool({ connectionString: url!.replace(/\/pediatrico_who_slice3_(?:test|verify|guard|sealed_test)$/, '/postgres') })
    const name = `pediatrico_who_gate_${randomUUID().replace(/-/g, '')}`
    const target = new URL(url!)
    target.pathname = `/${name}`
    try {
      await admin.query(`CREATE DATABASE "${name}"`)
      const connection = new Pool({ connectionString: target.href })
      try {
        await migrate(drizzle(connection), { migrationsFolder: './server/db/migrations' })
        const file = manifest.files[0]!
        const bytes = await readFile(resolve('/tmp/opencode/who-2006', `${file.name}-expanded.xlsx`))
        const source = metadata(file, bytes)
        const previous = process.env.DATABASE_URL
        try {
          process.env.DATABASE_URL = target.href
          const id = await importWhoDataset(source, await parseWhoWorkbook(source, bytes))
          expect(await getWhoRows(id, source.indicator, source.sex, null)).toEqual([])
          const all = await Promise.all(manifest.files.map(async (entry) => {
            const input = await readFile(resolve('/tmp/opencode/who-2006', `${entry.name}-expanded.xlsx`))
            const descriptor = metadata(entry, input)
            return { source: descriptor, rows: await parseWhoWorkbook(descriptor, input) }
          }))
          expect(await importWhoRelease(all)).toHaveLength(12)
          expect((await getWhoRows(id, source.indicator, source.sex, null)).length).toBe(1857)
        } finally {
          process.env.DATABASE_URL = previous
        }
      } finally {
        await connection.end()
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      await admin.end()
    }
  }, 120000)

  it('rolls back a partially imported release when a later existing dataset is unsealed', async () => {
    const admin = new Pool({ connectionString: url!.replace(/\/pediatrico_who_slice3_(?:test|verify|guard|sealed_test)$/, '/postgres') })
    const name = `pediatrico_who_partial_${randomUUID().replace(/-/g, '')}`
    const target = new URL(url!)
    target.pathname = `/${name}`
    try {
      await admin.query(`CREATE DATABASE "${name}"`)
      const connection = new Pool({ connectionString: target.href })
      try {
        await migrate(drizzle(connection), { migrationsFolder: './server/db/migrations' })
        const entries = await Promise.all(manifest.files.map(async (file) => {
          const bytes = await readFile(resolve('/tmp/opencode/who-2006', `${file.name}-expanded.xlsx`))
          const source = metadata(file, bytes)
          return { source, rows: await parseWhoWorkbook(source, bytes) }
        }))
        const prior = entries[1]!
        const { createHash } = await import('node:crypto')
        const id = createHash('sha256').update([prior.source.standard, prior.source.version, prior.source.indicator, prior.source.sex, prior.source.url, prior.source.sha256].join('|')).digest('hex')
        await drizzle(connection).insert(whoDataset).values({ id, publisher: prior.source.publisher, standard: prior.source.standard,
          version: prior.source.version, publicationDate: prior.source.publicationDate, retrievedAt: prior.source.retrievedAt,
          sourceUrl: prior.source.url, sha256: prior.source.sha256, indicator: prior.source.indicator, sex: prior.source.sex,
          position: prior.source.position, xUnit: prior.source.xUnit, minX: String(prior.source.minX), maxX: String(prior.source.maxX), rowCount: prior.rows.length })
        const previous = process.env.DATABASE_URL
        try {
          process.env.DATABASE_URL = target.href
          await expect(importWhoRelease(entries)).rejects.toThrow('does not match pinned release')
          expect((await connection.query('SELECT count(*)::int AS n FROM who_dataset')).rows[0].n).toBe(1)
          expect((await connection.query('SELECT count(*)::int AS n FROM who_reference_row')).rows[0].n).toBe(0)
        } finally {
          process.env.DATABASE_URL = previous
        }
      } finally {
        await connection.end()
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      await admin.end()
    }
  }, 120000)

  it('denies a database role with INSERT privilege appending rows to an already sealed dataset', async () => {
    const role = `who_insert_${randomUUID().replace(/-/g, '')}`
    const owner = new Pool({ connectionString: url })
    const administrator = new Pool({ connectionString: url!.replace(/\/pediatrico_who_slice3_(?:test|verify|guard|sealed_test)$/, '/postgres') })
    try {
      const [dataset] = (await owner.query('SELECT id FROM who_dataset WHERE indicator = $1 AND sex = $2 AND version = $3', ['WEIGHT_FOR_LENGTH', 'MALE', manifest.version])).rows
      await administrator.query(`CREATE ROLE "${role}" LOGIN`)
      await owner.query(`GRANT USAGE ON SCHEMA public TO "${role}"`)
      await owner.query(`GRANT INSERT ON who_reference_row TO "${role}"`)
      await owner.query(`GRANT SELECT, UPDATE ON who_dataset TO "${role}"`)
      const client = await owner.connect()
      try {
        await client.query(`SET ROLE "${role}"`)
        await expect(client.query(`INSERT INTO who_reference_row (dataset_id, indicator, sex, position, x_unit, x, l, m, s, sd_neg3, sd_neg2, sd_neg1, sd_0, sd_1, sd_2, sd_3) VALUES ($1, 'WEIGHT_FOR_LENGTH', 'MALE', 'RECUMBENT', 'CM', 45.1, 1, 3, 0.1, 1, 2, 2.5, 3, 3.5, 4, 5) ON CONFLICT DO NOTHING`, [dataset.id])).rejects.toThrow('sealed')
      } finally {
        await client.query('RESET ROLE')
        client.release()
      }
    } finally {
      await owner.query(`REVOKE INSERT ON who_reference_row FROM "${role}"`)
      await owner.query(`REVOKE SELECT, UPDATE ON who_dataset FROM "${role}"`)
      await owner.query(`REVOKE USAGE ON SCHEMA public FROM "${role}"`)
      await administrator.query(`DROP ROLE "${role}"`)
      await administrator.end()
      await owner.end()
    }
  })

  it('rejects a mismatched existing row without committing any new datasets', async () => {
    const entries = await Promise.all(manifest.files.map(async (file) => {
      const bytes = await readFile(resolve('/tmp/opencode/who-2006', `${file.name}-expanded.xlsx`))
      const source = metadata(file, bytes)
      return { source, rows: await parseWhoWorkbook(source, bytes) }
    }))
    const [existing] = await db.select().from(whoDataset).where(eq(whoDataset.sha256, entries[0]!.source.sha256))
    await expect(importWhoRelease([{ ...entries[0]!, rows: [{ ...entries[0]!.rows[0]!, m: 99 }, ...entries[0]!.rows.slice(1)] }, ...entries.slice(1)])).rejects.toThrow()
    expect((await getWhoRows(existing!.id as DatasetId, entries[0]!.source.indicator, entries[0]!.source.sex, null))[0]!.m).toBe(entries[0]!.rows[0]!.m)
  })

  it('never writes a subset when a later workbook is corrupt; retry can import the full release', async () => {
    const admin = new Pool({ connectionString: url!.replace(/\/pediatrico_who_slice3_(?:test|verify|guard|sealed_test)$/, '/postgres') })
    const name = `pediatrico_who_cli_${randomUUID().replace(/-/g, '')}`
    const target = new URL(url!)
    target.pathname = `/${name}`
    const sourceDir = await mkdtemp(join(tmpdir(), 'who-import-'))
    try {
      await admin.query(`CREATE DATABASE "${name}"`)
      const targetPool = new Pool({ connectionString: target.href })
      try {
        await migrate(drizzle(targetPool), { migrationsFolder: './server/db/migrations' })
      } finally {
        await targetPool.end()
      }
      for (const file of manifest.files) await copyFile(resolve('/tmp/opencode/who-2006', `${file.name}-expanded.xlsx`), join(sourceDir, `${file.name}-expanded.xlsx`))
      const cli = resolve('node_modules/.bin/tsx')
      const run = () => execFileSync(cli, ['scripts/import-who.ts', 'import'], {
        env: { ...process.env, DATABASE_URL: target.href, WHO_SOURCE_DIR: sourceDir, WHO_ALLOW_CLINICAL_IMPORT: 'yes' }, encoding: 'utf8', stdio: 'pipe'
      })
      await writeFile(join(sourceDir, 'hcfa-girls-expanded.xlsx'), 'corrupt late source')
      expect(() => run()).toThrow()
      const check = new Pool({ connectionString: target.href })
      try {
        expect((await check.query('SELECT count(*)::int AS n FROM who_dataset')).rows[0].n).toBe(0)
        expect((await check.query('SELECT count(*)::int AS n FROM who_reference_row')).rows[0].n).toBe(0)
      } finally {
        await check.end()
      }
      await copyFile(resolve('/tmp/opencode/who-2006/hcfa-girls-expanded.xlsx'), join(sourceDir, 'hcfa-girls-expanded.xlsx'))
      expect(run()).toContain('hcfa-girls: 1857 rows')
      expect(run()).toContain('wfa-boys: 1857 rows')
      const verify = new Pool({ connectionString: target.href })
      try {
        expect((await verify.query('SELECT count(*)::int AS n FROM who_dataset')).rows[0].n).toBe(12)
        expect((await verify.query('SELECT count(*)::int AS n FROM who_reference_row')).rows[0].n).toBe(17260)
      } finally {
        await verify.end()
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      await admin.end()
      await rm(sourceDir, { recursive: true, force: true })
    }
  }, 120000)

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
