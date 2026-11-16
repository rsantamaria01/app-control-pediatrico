import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { count, eq } from 'drizzle-orm'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { catalogItem, catalogRelease, doctorCatalogEntry } from '../../server/db/schema'
import { getCatalogView, importDraftCatalog, addDoctorMilestone } from '../../server/services/catalog-import'
import type { OfficialCatalogSource } from '../../shared/types/catalog'

const configured = process.env.WHO_TEST_DATABASE_URL
if (!configured || !['/pediatrico_who_slice3_test', '/pediatrico_who_slice3_verify', '/pediatrico_who_slice3_guard', '/pediatrico_who_slice3_sealed_test'].includes(new URL(configured).pathname) || configured === process.env.DATABASE_URL) throw new Error('Dedicated WHO test database required')
const name = `pediatrico_catalog_${randomUUID().replace(/-/g, '')}`
const target = new URL(configured)
target.pathname = `/${name}`
const admin = new URL(configured)
admin.pathname = '/postgres'
const adminPool = new Pool({ connectionString: admin.href })
const pool = new Pool({ connectionString: target.href })
const db = drizzle(pool)
const prior = process.env.DATABASE_URL
let created = false
const bytes = new TextEncoder().encode('Test-only fixture not clinical data')
const source: OfficialCatalogSource = { kind: 'MOTOR', publisher: 'WHO', title: 'Fixture', version: 'test-1', publicationDate: '2006-04-07', retrievedAt: '2026-11-16', url: 'https://cdn.who.int/fixture.pdf', sha256: createHash('sha256').update(bytes).digest('hex'), bytes }
const entry = { key: 'fixture', label: 'Fixture row', domain: 'GROSS_MOTOR', minAgeMonths: 1, maxAgeMonths: 2, sourcePage: '1' }

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${name}"`)
  created = true
  process.env.DATABASE_URL = target.href
  await migrate(db, { migrationsFolder: './server/db/migrations' })
}, 120000)
afterAll(async () => {
  process.env.DATABASE_URL = prior
  await pool.end()
  const { useDb } = await import('../../server/utils/db')
  await useDb().$client.end()
  try {
    if (created) await adminPool.query(`DROP DATABASE "${name}"`)
  } finally {
    await adminPool.end()
  }
})

describe('immutable preventive catalogs on disposable database', () => {
  it('keeps migration metadata parseable and aligned with catalog date and draft constraints', async () => {
    const snapshot = JSON.parse(await readFile('server/db/migrations/meta/0031_snapshot.json', 'utf8'))
    const release = snapshot.tables['public.catalog_release']
    const item = snapshot.tables['public.catalog_item']
    const sql = await readFile('server/db/migrations/0031_nebulous_ronan.sql', 'utf8')
    for (const [name, table] of [['catalog_release', release], ['catalog_item', item]] as const) {
      for (const [constraint, definition] of Object.entries(table.checkConstraints) as [string, { value: string }][]) {
        expect(sql).toContain(`CONSTRAINT "${constraint}" CHECK (${definition.value})`)
      }
      expect(table.name).toBe(name)
    }
    expect(release.checkConstraints.catalog_release_date_ck.value).toContain(`'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`)
    expect(release.checkConstraints.catalog_release_draft_ck.value).toContain('DRAFT_PENDING_PEDIATRICIAN_REVIEW')
    expect(item.checkConstraints.catalog_item_draft_ck.value).toContain('DRAFT_PENDING_PEDIATRICIAN_REVIEW')
  })

  it('keeps prior revisions and exposes draft badges on each row', async () => {
    const first = await importDraftCatalog(source, [entry])
    const second = await importDraftCatalog({ ...source, version: 'test-2' }, [{ ...entry, label: 'Revised fixture' }])
    const view = await getCatalogView('MOTOR')
    expect(view.versions).toHaveLength(2)
    expect(view.versions.map(version => version.id)).toContain(first.id)
    expect(view.versions.map(version => version.id)).toContain(second.id)
    expect(view.versions.flatMap(version => version.entries).map(row => row.badge)).toEqual(['Borrador - pendiente de revisión', 'Borrador - pendiente de revisión'])
    expect(view.versions.find(version => version.id === first.id)?.entries[0]?.label).toBe('Fixture row')
    expect((await importDraftCatalog(source, [entry])).id).toBe(first.id)
    expect((await db.select({ n: count() }).from(catalogRelease))[0]!.n).toBe(2)
    await expect(db.update(catalogRelease).set({ status: 'REVIEWED' })).rejects.toThrow()
    await expect(db.update(catalogItem).set({ status: 'REVIEWED' })).rejects.toThrow()
    await expect(db.update(catalogItem).set({ label: 'Changed' })).rejects.toThrow()
    await expect(db.delete(catalogRelease)).rejects.toThrow()
  })

  it('fails closed before inserting any draft when AAP original cannot be fetched', async () => {
    const preload = `globalThis.fetch = async () => { throw new Error('AAP original unavailable') }`
    const env = { ...process.env, DATABASE_URL: target.href, NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(preload)}` }
    expect(() => execFileSync('node', ['scripts/prepare-catalogs.mjs'], { env, encoding: 'utf8', stdio: 'pipe' })).toThrow('AAP original unavailable')
    expect((await getCatalogView('VACCINE')).versions).toEqual([])
    expect((await getCatalogView('CHECKUP')).versions).toEqual([])
  })

  it('rejects a replaced AAP original before inserting either draft release', async () => {
    const preload = `globalThis.fetch = async () => ({ arrayBuffer: async () => new Uint8Array(317138).buffer })`
    const env = { ...process.env, DATABASE_URL: target.href, NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(preload)}` }
    expect(() => execFileSync('node', ['scripts/prepare-catalogs.mjs'], { env, encoding: 'utf8', stdio: 'pipe' })).toThrow('Source mismatch: periodicity_schedule.pdf')
    expect((await getCatalogView('VACCINE')).versions).toEqual([])
    expect((await getCatalogView('CHECKUP')).versions).toEqual([])
  })

  it('retains an immutable pre-correction MSP release while prepare imports its corrected content revision and the doctor sees only current facts', async () => {
    const manifest = JSON.parse(await readFile('scripts/preventive-catalog-manifest.json', 'utf8'))
    const schedule = manifest.sources[0]
    const manual = manifest.sources[1]
    const oldId = createHash('sha256').update('pre-correction-release').digest('hex')
    await db.insert(catalogRelease).values({ id: oldId, kind: 'VACCINE', publisher: schedule.publisher, title: schedule.title, version: schedule.version, publicationDate: null,
      retrievedAt: manifest.retrievedAt, url: schedule.url, sha256: schedule.sha256, sources: [
        { file: schedule.file, url: schedule.url, sha256: schedule.sha256 }, { file: manual.file, url: manual.url, sha256: manual.sha256 }
      ] })
    await db.insert(catalogItem).values({ releaseId: oldId, key: 'bopv-1', label: 'bOPV oral (distinta de IPV en hexavalente)', domain: 'MSP',
      minAgeMonths: '6', maxAgeMonths: '6', sourcePage: `${schedule.file} p. 1; ${manual.file} p. 164`, sourcePages: [{ file: schedule.file, page: 1 }, { file: manual.file, page: 164 }], doseNumber: '1', recommendedAge: '6 meses' })
    const env = { ...process.env, DATABASE_URL: target.href }
    const prepare = () => execFileSync('node', ['scripts/prepare-catalogs.mjs'], { env, encoding: 'utf8' })
    expect(prepare()).toContain('VACCINE')
    const adminView = await getCatalogView('VACCINE')
    expect(adminView.versions).toHaveLength(2)
    expect(adminView.versions.find(version => version.id === oldId)?.entries[0]?.doseNumber).toBe(1)
    expect(adminView.versions.find(version => version.id === oldId)?.superseded).toBe(true)
    expect(adminView.versions.find(version => version.id !== oldId)?.superseded).toBe(false)
    expect(adminView.versions.find(version => version.id !== oldId)?.entries.find(row => row.key === 'bopv-1')?.doseLabel).toBe('bOPV oral a los 6 meses (IPV en hexavalente)')
    const doctorView = await getCatalogView('VACCINE', true)
    expect(doctorView.versions).toHaveLength(1)
    expect(doctorView.versions[0]?.entries.find(row => row.key === 'bopv-1')).not.toHaveProperty('doseNumber')
    await expect(db.update(catalogItem).set({ doseNumber: null }).where(eq(catalogItem.releaseId, oldId))).rejects.toThrow()
    await expect(db.delete(catalogRelease).where(eq(catalogRelease.id, oldId))).rejects.toThrow()
    prepare()
    expect((await getCatalogView('VACCINE')).versions).toHaveLength(2)
  })

  it('runs the same migration-then-import startup as production, idempotently on retry', async () => {
    const env = { ...process.env, DATABASE_URL: target.href }
    const start = () => execFileSync('node', ['scripts/prepare-catalogs.mjs'], { env, encoding: 'utf8' })
    expect(start()).toContain('VACCINE')
    expect((await getCatalogView('VACCINE')).versions.find(version => !version.superseded)?.entries).toHaveLength(21)
    expect((await getCatalogView('CHECKUP')).versions[0]?.entries).toHaveLength(31)
    start()
    expect((await getCatalogView('VACCINE')).versions).toHaveLength(2)
    expect((await getCatalogView('CHECKUP')).versions).toHaveLength(1)
  })

  it('imports verified official facts by CLI and leaves milestone catalog unseeded on rerun', async () => {
    const env = { ...process.env, DATABASE_URL: target.href }
    const command = () => execFileSync('pnpm', ['exec', 'tsx', 'scripts/import-preventive-catalogs.ts', 'import'], { env, encoding: 'utf8' })
    expect(command()).toContain('VACCINE')
    const first = (await getCatalogView('VACCINE')).versions.find(version => !version.superseded)!
    expect(first.entries.length).toBeGreaterThan(10)
    expect(first.entries.find(row => row.key === 'pcv-2')?.minimumInterval).toBeNull()
    expect(first.entries.find(row => row.key === 'bopv-1')).toMatchObject({ doseLabel: 'bOPV oral a los 6 meses (IPV en hexavalente)' })
    expect(first.entries.find(row => row.key === 'bopv-2')).toMatchObject({ doseLabel: 'bOPV oral: primer refuerzo' })
    expect(first.entries.find(row => row.key === 'bopv-3')).toMatchObject({ doseLabel: 'bOPV oral: segundo refuerzo' })
    expect(first.entries.find(row => row.key === 'dpt-1')).toMatchObject({ doseLabel: 'DPT: refuerzo a los 5 años' })
    for (const key of ['bopv-1', 'bopv-2', 'bopv-3', 'dpt-1']) expect(first.entries.find(row => row.key === key)).not.toHaveProperty('doseNumber')
    expect(first.entries.find(row => row.key === 'rotavirus-2')).toMatchObject({ doseNumber: 2, recommendedAge: '4 meses', minimumInterval: '1 mes' })
    expect(first.entries.every(row => row.badge === 'Borrador - pendiente de revisión' && row.sourcePages?.length === 2)).toBe(true)
    expect((await getCatalogView('CHECKUP')).versions[0]?.entries.some(row => row.key === 'day-3-5' && row.minAgeDays === 3 && row.maxAgeDays === 5)).toBe(true)
    expect((await getCatalogView('MILESTONE')).versions).toHaveLength(0)
    command()
    expect((await getCatalogView('VACCINE')).versions).toHaveLength(2)
  })

  it('reuses an imported content revision without changing source history or adding rows', async () => {
    const revisionSource = { ...source, version: 'repeat-identical' }
    const first = await importDraftCatalog(revisionSource, [entry])
    const second = await importDraftCatalog(revisionSource, [entry])
    expect(second).toEqual(first)
    expect((await db.select({ n: count() }).from(catalogItem).where(eq(catalogItem.releaseId, first.id)))[0]?.n).toBe(1)
    await expect(db.update(catalogRelease).set({ revision: 'changed' }).where(eq(catalogRelease.id, first.id))).rejects.toThrow()
  })

  it('deduplicates simultaneous imports of the same immutable content revision', async () => {
    const concurrentSource = { ...source, version: 'simultaneous-test' }
    const revisions = await Promise.all(Array.from({ length: 4 }, () => importDraftCatalog(concurrentSource, [entry])))
    expect(new Set(revisions.map(revision => revision.id)).size).toBe(1)
    expect((await getCatalogView('MOTOR')).versions.filter(version => version.version === 'simultaneous-test')).toHaveLength(1)
  })

  it('migrates an existing 0035 catalog release without changing its immutable rows', async () => {
    const migrationDirectory = await mkdtemp(join(tmpdir(), 'catalog-upgrade-'))
    const adminUrl = new URL(configured!)
    adminUrl.pathname = '/postgres'
    const database = `pediatrico_catalog_upgrade_${randomUUID().replace(/-/g, '')}`
    const upgradeUrl = new URL(configured!)
    upgradeUrl.pathname = `/${database}`
    const adminConnection = new Pool({ connectionString: adminUrl.href })
    const upgradePool = new Pool({ connectionString: upgradeUrl.href })
    let exists = false
    try {
      await adminConnection.query(`CREATE DATABASE "${database}"`)
      exists = true
      await mkdir(join(migrationDirectory, 'meta'))
      const journal = JSON.parse(await readFile('server/db/migrations/meta/_journal.json', 'utf8'))
      const priorEntries = journal.entries.filter((record: { idx: number }) => record.idx <= 35)
      await writeFile(join(migrationDirectory, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: priorEntries }))
      for (const record of priorEntries) await copyFile(`server/db/migrations/${record.tag}.sql`, join(migrationDirectory, `${record.tag}.sql`))
      await migrate(drizzle(upgradePool), { migrationsFolder: migrationDirectory })
      await upgradePool.query(`INSERT INTO catalog_release (id, kind, publisher, title, version, publication_date, retrieved_at, url, sha256) VALUES ($1,'VACCINE','MSP','Prior','2026-07',null,'2026-11-16',$2,$3)`, ['prior-release', 'https://www.salud.gob.ec/prior.pdf', 'a'.repeat(64)])
      await upgradePool.query(`INSERT INTO catalog_item (release_id,key,label,domain,min_age_months,max_age_months,source_page) VALUES ('prior-release','bopv-1','Old oral dose','MSP',6,6,'manual p164')`)
      const before = (await upgradePool.query(`SELECT row_to_json(catalog_release.*) AS release FROM catalog_release WHERE id = 'prior-release'`)).rows[0].release
      await migrate(drizzle(upgradePool), { migrationsFolder: './server/db/migrations' })
      const after = (await upgradePool.query(`SELECT row_to_json(catalog_release.*) AS release FROM catalog_release WHERE id = 'prior-release'`)).rows[0].release
      expect(after).toEqual({ ...before, revision: 'legacy' })
      expect((await upgradePool.query(`SELECT label FROM catalog_item WHERE release_id = 'prior-release'`)).rows[0].label).toBe('Old oral dose')
      await expect(upgradePool.query(`UPDATE catalog_item SET label = 'changed' WHERE release_id = 'prior-release'`)).rejects.toThrow()
    } finally {
      await upgradePool.end()
      await rm(migrationDirectory, { recursive: true, force: true })
      try {
        if (exists) await adminConnection.query(`DROP DATABASE "${database}"`)
      } finally {
        await adminConnection.end()
      }
    }
  }, 120000)

  it('keeps the generated migration metadata aligned with the content-revision identity on a migrated database', async () => {
    const snapshot = JSON.parse(await readFile('server/db/migrations/meta/0036_snapshot.json', 'utf8'))
    const release = snapshot.tables['public.catalog_release']
    const migration = await readFile('server/db/migrations/0036_glorious_songbird.sql', 'utf8')
    expect(release.indexes.catalog_release_identity_idx.columns.map((column: { expression: string }) => column.expression)).toEqual(['kind', 'publisher', 'version', 'url', 'revision'])
    expect(migration).toContain(`CREATE UNIQUE INDEX "catalog_release_identity_idx" ON "catalog_release" USING btree ("kind","publisher","version","url","revision")`)
    const indexes = await db.$client.query(`SELECT indexdef FROM pg_indexes WHERE tablename = 'catalog_release' AND indexname = 'catalog_release_identity_idx'`)
    expect(indexes.rows[0]?.indexdef).toContain('(kind, publisher, version, url, revision)')
  })

  it('keeps a second content revision with the same source identity, each immutable and individually marked in admin history', async () => {
    const original = await importDraftCatalog({ ...source, version: 'revision-test' }, [entry])
    const revised = await importDraftCatalog({ ...source, version: 'revision-test' }, [{ ...entry, label: 'Corrected fixture' }])
    expect(original.id).not.toBe(revised.id)
    const versions = (await getCatalogView('MOTOR')).versions.filter(version => version.version === 'revision-test')
    expect(versions).toHaveLength(2)
    expect(versions.find(version => version.id === original.id)).toMatchObject({ superseded: true, entries: [{ label: 'Fixture row' }] })
    expect(versions.find(version => version.id === revised.id)).toMatchObject({ superseded: false, entries: [{ label: 'Corrected fixture' }] })
    expect((await getCatalogView('MOTOR', true)).versions.filter(version => version.version === 'revision-test').map(version => version.id)).toEqual([revised.id])
  })

  it('keeps the seeded milestone list empty and persists a doctor-authored draft separately', async () => {
    expect((await getCatalogView('MILESTONE')).versions).toEqual([])
    const doctor = { id: randomUUID(), roles: ['DOCTOR' as const] }
    const created = await addDoctorMilestone(doctor, { label: 'Observación ingresada por médico', domain: 'Motor', minAgeMonths: 4, maxAgeMonths: 6, source: 'Registro del médico' })
    expect(created.badge).toBe('Borrador - pendiente de revisión')
    expect((await getCatalogView('MILESTONE')).doctorEntries).toBeUndefined()
    expect((await getCatalogView('MILESTONE', true)).doctorEntries).toContainEqual(created)
    expect((await db.select().from(doctorCatalogEntry)).find(item => item.id === created.id)?.authorId).toBe(doctor.id)
    await expect(db.update(doctorCatalogEntry).set({ label: 'Changed' })).rejects.toThrow()
  })

  it('stores sourced vaccine doses with nullable interval and immutable multi-file page evidence', async () => {
    const vaccineSource = { ...source, kind: 'VACCINE' as const, publisher: 'MSP', url: 'https://www.salud.gob.ec/schedule.pdf', sourceFile: 'schedule.pdf', additionalSources: [{ file: 'manual.pdf', url: 'https://www.salud.gob.ec/manual.pdf', sha256: source.sha256, bytes }] }
    const version = await importDraftCatalog(vaccineSource, [{ ...entry, key: 'dose-1', doseNumber: 1, recommendedAge: '2 meses', minimumInterval: null, sourcePages: [{ file: 'schedule.pdf', page: 1 }, { file: 'manual.pdf', page: 142 }] }])
    const row = (await getCatalogView('VACCINE')).versions.find(item => item.id === version.id)!.entries[0]!
    expect(row).toMatchObject({ doseNumber: 1, recommendedAge: '2 meses', minimumInterval: null, sourcePages: [{ file: 'schedule.pdf', page: 1 }, { file: 'manual.pdf', page: 142 }], badge: 'Borrador - pendiente de revisión' })
    expect(version.sources).toHaveLength(2)
    await expect(db.update(catalogItem).set({ sourcePage: '999' })).rejects.toThrow()
  })
})
