import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { count } from 'drizzle-orm'
import { catalogItem, catalogRelease } from '../../server/db/schema'
import { getCatalogView, importDraftCatalog } from '../../server/services/catalog-import'
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
  it('keeps prior revisions and exposes draft badges on each row', async () => {
    const first = await importDraftCatalog(source, [entry])
    const second = await importDraftCatalog({ ...source, version: 'test-2' }, [{ ...entry, label: 'Revised fixture' }])
    const view = await getCatalogView('MOTOR')
    expect(view.versions).toHaveLength(2)
    expect(view.versions.map(version => version.id)).toContain(first.id)
    expect(view.versions.map(version => version.id)).toContain(second.id)
    expect(view.versions.flatMap(version => version.entries).map(row => row.badge)).toEqual(['Borrador · pendiente de revisión pediátrica', 'Borrador · pendiente de revisión pediátrica'])
    expect(view.versions.find(version => version.id === first.id)?.entries[0]?.label).toBe('Fixture row')
    await expect(importDraftCatalog(source, [entry])).rejects.toThrow()
    expect((await db.select({ n: count() }).from(catalogRelease))[0]!.n).toBe(2)
    await expect(db.update(catalogRelease).set({ status: 'REVIEWED' })).rejects.toThrow()
    await expect(db.update(catalogItem).set({ status: 'REVIEWED' })).rejects.toThrow()
    await expect(db.update(catalogItem).set({ label: 'Changed' })).rejects.toThrow()
    await expect(db.delete(catalogRelease)).rejects.toThrow()
  })
})
