import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { count } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
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

  it('keeps the seeded milestone list empty and persists a doctor-authored draft separately', async () => {
    expect((await getCatalogView('MILESTONE')).versions).toEqual([])
    const doctor = { id: randomUUID(), roles: ['DOCTOR' as const] }
    const created = await addDoctorMilestone(doctor, { label: 'Observación ingresada por médico', domain: 'Motor', minAgeMonths: 4, maxAgeMonths: 6, source: 'Registro del médico' })
    expect(created.badge).toBe('Borrador - pendiente de revisión')
    expect((await getCatalogView('MILESTONE')).doctorEntries).toContainEqual(created)
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
