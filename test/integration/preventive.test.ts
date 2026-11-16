import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import type { Actor } from '../../shared/types/access'
import { catalogItem, catalogRelease, guardianGrant, patient, user } from '../../server/db/schema'
import { recordDose, listVaccines, listVaccinationReview, listAppliedDoses, addComplementaryVaccine } from '../../server/services/vaccination'
import { assessMilestone, listDevelopment, recordScreening } from '../../server/services/development'
import { nextCheckups, recordCheckup, setIndividualCheckup } from '../../server/services/checkups'

const configured = process.env.WHO_TEST_DATABASE_URL
if (!configured || !['/pediatrico_who_slice3_test', '/pediatrico_who_slice3_verify', '/pediatrico_who_slice3_guard', '/pediatrico_who_slice3_sealed_test'].includes(new URL(configured).pathname) || configured === process.env.DATABASE_URL) throw new Error('Dedicated WHO test database required')
const name = `pediatrico_preventive_${randomUUID().replace(/-/g, '')}`
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
const adminActor: Actor = { id: randomUUID(), roles: ['ADMIN'] }
const guardian: Actor = { id: randomUUID(), roles: ['PATIENT'] }
const stranger: Actor = { id: randomUUID(), roles: ['PATIENT'] }
const child = randomUUID()
const release = 'a'.repeat(64)
const checkupRelease = 'b'.repeat(64)
let created = false

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${name}"`)
  created = true
  process.env.DATABASE_URL = target.href
  await migrate(db, { migrationsFolder: './server/db/migrations' })
  await db.insert(patient).values({ id: child, name: 'Niña prueba', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
  await db.insert(user).values({ id: guardian.id, name: 'Representante verificada', email: 'guardian-preventive@example.test' })
  await db.insert(guardianGrant).values({ patientId: child, guardianId: guardian.id, contactEmail: 'guardian-preventive@example.test', contactPhone: '0991234567', proof: 'Identidad presencial', verifiedBy: doctor.id, status: 'ACTIVE' })
  await db.insert(catalogRelease).values([
    { id: release, kind: 'VACCINE', publisher: 'MSP Ecuador', title: 'Esquema de prueba', version: '2026-07', publicationDate: null, retrievedAt: '2026-11-16', url: 'https://www.salud.gob.ec/test.pdf', sha256: release },
    { id: checkupRelease, kind: 'CHECKUP', publisher: 'AAP', title: 'Edades de prueba', version: '2025', publicationDate: null, retrievedAt: '2026-11-16', url: 'https://www.aap.org/test.pdf', sha256: checkupRelease }
  ])
  await db.insert(catalogItem).values([
    { releaseId: release, key: 'fixture-1', label: 'Vacuna de prueba', domain: 'MSP', minAgeMonths: '12', maxAgeMonths: '12', sourcePage: 'p. 1', doseNumber: '1', recommendedAge: '12 meses', minimumInterval: null },
    { releaseId: release, key: 'fixture-2', label: 'Vacuna de prueba', domain: 'MSP', minAgeMonths: '18', maxAgeMonths: '18', sourcePage: 'p. 2', doseNumber: '2', recommendedAge: '18 meses', minimumInterval: '1 mes' },
    { releaseId: checkupRelease, key: 'age-2', label: '2 años', domain: 'Control por edad', minAgeMonths: '24', maxAgeMonths: '24', sourcePage: 'p. 1' },
    { releaseId: checkupRelease, key: 'age-3', label: '3 años', domain: 'Control por edad', minAgeMonths: '36', maxAgeMonths: '36', sourcePage: 'p. 1' }
  ])
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

describe('doctor-only preventive record and draft review', () => {
  it('does not infer absent minimum age, interval or catch-up rules and shows a draft badge for each pending fact', async () => {
    const rows = await listVaccines(doctor, child, new Date('2026-11-16T12:00:00Z'))
    expect(rows.pending.map(row => row.key)).toEqual(['fixture-1', 'fixture-2'])
    expect(rows.pending.every(row => row.badge === 'Borrador - pendiente de revisión')).toBe(true)
    expect(rows.pending[0]).toMatchObject({ minimumInterval: null, sourcePage: 'p. 1', status: 'DRAFT_PENDING_PEDIATRICIAN_REVIEW' })
    expect(rows.pending[1]).toMatchObject({ minimumInterval: '1 mes', version: '2026-07' })
    expect(JSON.stringify(rows)).not.toMatch(/recuperación automática|fecha límite|dosis de rescate/i)
  })

  it('retains a dose snapshot and private lot after a catalog revision; guardian sees only applied public fields', async () => {
    await expect(recordDose(assistant, child, { releaseId: release, key: 'fixture-1', appliedAt: '2026-01-02', lot: 'PRIVATE_LOT', privateNote: 'PRIVATE_NOTE', external: true })).rejects.toMatchObject({ statusCode: 403 })
    const dose = await recordDose(doctor, child, { releaseId: release, key: 'fixture-1', appliedAt: '2026-01-02', lot: 'PRIVATE_LOT', privateNote: 'PRIVATE_NOTE', external: true })
    expect(dose).toMatchObject({ label: 'Vacuna de prueba', catalogVersion: '2026-07', releaseId: release, external: true, lot: 'PRIVATE_LOT' })
    const revised = 'c'.repeat(64)
    await db.insert(catalogRelease).values({ id: revised, kind: 'VACCINE', publisher: 'MSP Ecuador', title: 'Esquema de prueba', version: '2026-07', revision: revised, publicationDate: null, retrievedAt: '2026-11-16', url: 'https://www.salud.gob.ec/test.pdf', sha256: revised })
    await db.insert(catalogItem).values({ releaseId: revised, key: 'fixture-1', label: 'Nombre nuevo', domain: 'MSP', minAgeMonths: '12', maxAgeMonths: '12', sourcePage: 'p. 9' })
    const history = await listVaccines(doctor, child)
    expect(history.applied[0]).toMatchObject({ label: 'Vacuna de prueba', catalogVersion: '2026-07', sourcePage: 'p. 1' })
    const family = await listAppliedDoses(guardian, child)
    expect(family).toMatchObject([{ label: 'Vacuna de prueba', appliedAt: '2026-01-02' }])
    expect(JSON.stringify(family)).not.toMatch(/PRIVATE_LOT|PRIVATE_NOTE|releaseId|contactPhone|pending/i)
    await expect(listAppliedDoses(stranger, child)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('rejects a second application of the same catalog dose and excludes completed doses from review', async () => {
    await expect(recordDose(doctor, child, { releaseId: release, key: 'fixture-1', appliedAt: '2026-01-02', external: false })).rejects.toThrow()
    const review = await listVaccinationReview(doctor)
    expect(review.find(item => item.id === child)?.pending.some(item => item.key === 'fixture-1' && item.id.startsWith(release))).toBe(false)
  })

  it('includes MSP and clinician-authored complementary items in one review queue with verified contact only', async () => {
    await addComplementaryVaccine(doctor, { label: 'Complementaria de prueba', doseLabel: 'Dosis propuesta', source: 'Criterio de la doctora (fixture)', patientId: child })
    const review = await listVaccinationReview(doctor, new Date('2026-11-16T12:00:00Z'))
    const row = review.find(item => item.id === child)!
    expect(row.pending.some(item => item.kind === 'MSP')).toBe(true)
    expect(row.pending.some(item => item.kind === 'COMPLEMENTARY' && item.badge === 'Borrador - pendiente de revisión')).toBe(true)
    expect(row.contacts).toEqual([{ name: 'Representante verificada', phone: '0991234567' }])
    await expect(listVaccinationReview(assistant)).rejects.toMatchObject({ statusCode: 403 })
    await expect(listVaccinationReview(adminActor)).rejects.toMatchObject({ statusCode: 403 })
    await expect(listVaccinationReview(guardian)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('records clinician assessment without invented WHO walking dependency or CDC age claims', async () => {
    await assessMilestone(doctor, child, { label: 'Caminar (registro clínico de prueba)', domain: 'GROSS_MOTOR', outcome: 'ACHIEVED', acquiredAgeMonths: 17, privateNote: 'PRIVATE_ASSESSMENT' })
    const state = await listDevelopment(doctor, child)
    expect(state.assessments).toMatchObject([{ outcome: 'ACHIEVED', acquiredAgeMonths: 17 }])
    expect(state.milestones).toEqual([])
    expect(JSON.stringify(state)).not.toMatch(/gatear.*requisito|edad CDC/i)
    await expect(assessMilestone(doctor, child, { label: 'Otro', domain: 'LANGUAGE', outcome: 'NOT_ACHIEVED', acquiredAgeMonths: 3 })).rejects.toThrow()
    await expect(listDevelopment(assistant, child)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('distinguishes a source-gated screening reminder from an applied instrument and result', async () => {
    const state = await listDevelopment(doctor, child)
    expect(state.screenings).toEqual([])
    expect(state.reminders).toEqual([])
    await recordScreening(doctor, child, 'Instrumento de prueba', { category: 'DEVELOPMENT', appliedAt: '2026-01-03', result: 'Resultado clínico de prueba', privateNote: 'PRIVATE_SCREENING' })
    expect((await listDevelopment(doctor, child)).screenings).toMatchObject([{ instrument: 'Instrumento de prueba', result: 'Resultado clínico de prueba' }])
  })

  it('uses only sourced AAP ages and individual overrides, omitting a completed control', async () => {
    const before = await nextCheckups(child)
    expect(before.map(row => row.key)).toEqual(['age-2', 'age-3'])
    expect(before.every(row => row.badge === 'Borrador - pendiente de revisión')).toBe(true)
    await recordCheckup(doctor, child, { releaseId: checkupRelease, key: 'age-2', completedAt: '2026-01-05' })
    await setIndividualCheckup(doctor, child, { date: '2027-02-01', reason: 'Control individual de prueba' })
    const after = await nextCheckups(child)
    expect(after.map(row => row.key)).toEqual(['age-3', null])
    expect(after[1]).toMatchObject({ date: '2027-02-01', reason: 'Control individual de prueba' })
  })
})
