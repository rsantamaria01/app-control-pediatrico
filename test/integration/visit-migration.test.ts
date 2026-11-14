import { randomUUID } from 'node:crypto'
import { readFile, mkdtemp, copyFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { Pool } from 'pg'

const configured = process.env.WHO_TEST_DATABASE_URL
if (!configured || !['/pediatrico_who_slice3_test', '/pediatrico_who_slice3_verify', '/pediatrico_who_slice3_guard', '/pediatrico_who_slice3_sealed_test'].includes(new URL(configured).pathname) || configured === process.env.DATABASE_URL) throw new Error('Dedicated WHO test database required')
const name = `pediatrico_slice6_upgrade_${randomUUID().replace(/-/g, '')}`
const target = new URL(configured)
target.pathname = `/${name}`
const admin = new URL(configured)
admin.pathname = '/postgres'
const adminPool = new Pool({ connectionString: admin.href })
const pool = new Pool({ connectionString: target.href })
const previous = process.env.DATABASE_URL
let created = false

const migrationDirectory = await mkdtemp(join(tmpdir(), 'clinical-upgrade-'))

async function prepareMigrations(count: number) {
  const journal = JSON.parse(await readFile('server/db/migrations/meta/_journal.json', 'utf8')) as { entries: Array<{ tag: string }> }
  journal.entries = journal.entries.slice(0, count)
  await rm(join(migrationDirectory, 'meta'), { recursive: true, force: true })
  await mkdir(join(migrationDirectory, 'meta'))
  await writeFile(join(migrationDirectory, 'meta', '_journal.json'), JSON.stringify(journal))
  for (const entry of journal.entries) await copyFile(`server/db/migrations/${entry.tag}.sql`, join(migrationDirectory, `${entry.tag}.sql`))
}

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${name}"`)
  created = true
  process.env.DATABASE_URL = target.href
  await prepareMigrations(14)
  await migrate(drizzle(pool), { migrationsFolder: migrationDirectory })
})

afterAll(async () => {
  process.env.DATABASE_URL = previous
  await pool.end()
  const { useDb } = await import('../../server/utils/db')
  await useDb().$client.end()
  await rm(migrationDirectory, { recursive: true, force: true })
  try {
    if (created) await adminPool.query(`DROP DATABASE "${name}"`)
  } finally {
    await adminPool.end()
  }
})

it('upgrades a populated immutable visit without guessing the original birth date or sex', async () => {
  const patientId = randomUUID()
  const visitId = randomUUID()
  const resultId = randomUUID()
  await pool.query('INSERT INTO patient (id, name, birth_date, sex, correction_until_months, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [patientId, 'Paciente previo', '2024-01-01', 'FEMALE', 24, 'doctor'])
  await pool.query('INSERT INTO clinical_visit (id, patient_id, request_id, request_digest, measured_at, weight_kg, length_height_cm, position, head_circumference_cm, bmi, correction_until_months, author_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [visitId, patientId, randomUUID(), 'legacy', '2025-01-01T12:00:00.000Z', 9, 75, 'RECUMBENT', 45, 16, 24, 'doctor'])
  await pool.query('INSERT INTO visit_result (id, visit_id, indicator, snapshot) VALUES ($1,$2,$3,$4)', [resultId, visitId, 'WEIGHT_FOR_AGE', JSON.stringify({ status: 'unavailable', reason: 'WHO reference unavailable' })])
  await pool.query('UPDATE patient SET birth_date = $1, sex = $2 WHERE id = $3', ['2024-02-01', 'MALE', patientId])
  await prepareMigrations(15)
  await migrate(drizzle(pool), { migrationsFolder: migrationDirectory })
  const [row] = (await pool.query('SELECT birth_date_at_visit, sex_at_visit, weight_kg FROM clinical_visit WHERE id = $1', [visitId])).rows
  expect(row).toMatchObject({ birth_date_at_visit: null, sex_at_visit: null, weight_kg: '9' })
  expect((await pool.query('SELECT snapshot FROM visit_result WHERE id = $1', [resultId])).rows[0].snapshot).toEqual({ status: 'unavailable', reason: 'WHO reference unavailable' })
  expect((await pool.query('SELECT birth_date, sex FROM patient WHERE id = $1', [patientId])).rows[0]).toMatchObject({ birth_date: '2024-02-01', sex: 'MALE' })
  await expect(pool.query('UPDATE clinical_visit SET weight_kg = 10 WHERE id = $1', [visitId])).rejects.toThrow('Clinical snapshots are immutable')
  const { recalculateVisit } = await import('../../server/services/visits')
  await expect(recalculateVisit({ id: 'doctor', roles: ['DOCTOR'] }, patientId, visitId, { requestId: randomUUID() })).rejects.toMatchObject({ statusCode: 409 })
  const [audit] = (await pool.query('SELECT outcome FROM audit_event WHERE action = $1 AND subject_id = $2', ['CLINICAL_RECALCULATE', patientId])).rows
  expect(audit).toMatchObject({ outcome: 'DENIED' })
  expect((await pool.query('SELECT count(*)::int AS count FROM visit_result WHERE visit_id = $1', [visitId])).rows[0].count).toBe(1)
})
