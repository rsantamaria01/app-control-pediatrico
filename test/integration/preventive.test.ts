import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import type { Actor } from '../../shared/types/access'
import { catalogItem, catalogRelease, guardianGrant, patient, user, vaccineDose } from '../../server/db/schema'
import { eq, sql } from 'drizzle-orm'
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
const intervalChild = randomUUID()
const newborn = randomUUID()
const release = 'a'.repeat(64)
const checkupRelease = 'b'.repeat(64)
let created = false

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${name}"`)
  created = true
  process.env.DATABASE_URL = target.href
  await migrate(db, { migrationsFolder: './server/db/migrations' })
  await db.insert(patient).values([{ id: child, name: 'Niña prueba', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id }, { id: intervalChild, name: 'Niño intervalo', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id }, { id: newborn, name: 'Recién nacido', birthDate: '2026-11-15', sex: 'MALE', createdBy: doctor.id }])
  await db.insert(user).values({ id: guardian.id, name: 'Representante verificada', email: 'guardian-preventive@example.test' })
  await db.insert(guardianGrant).values({ patientId: child, guardianId: guardian.id, contactEmail: 'guardian-preventive@example.test', contactPhone: '0991234567', proof: 'Identidad presencial', verifiedBy: doctor.id, status: 'ACTIVE' })
  await db.insert(catalogRelease).values([
    { id: release, kind: 'VACCINE', publisher: 'MSP Ecuador', title: 'Esquema de prueba', version: '2026-07', publicationDate: null, retrievedAt: '2026-11-16', url: 'https://www.salud.gob.ec/test.pdf', sha256: release },
    { id: checkupRelease, kind: 'CHECKUP', publisher: 'AAP', title: 'Edades de prueba', version: '2025', publicationDate: null, retrievedAt: '2026-11-16', url: 'https://www.aap.org/test.pdf', sha256: checkupRelease }
  ])
  await db.insert(catalogItem).values([
    { releaseId: release, key: 'fixture-1', label: 'Vacuna de prueba', domain: 'MSP', minAgeMonths: '12', maxAgeMonths: '12', sourcePage: 'p. 1', doseNumber: '1', recommendedAge: '12 meses', minimumInterval: null },
    { releaseId: release, key: 'fixture-2', label: 'Vacuna de prueba', domain: 'MSP', minAgeMonths: '18', maxAgeMonths: '18', sourcePage: 'p. 2', doseNumber: '2', recommendedAge: '18 meses', minimumInterval: '1 mes' },
    { releaseId: checkupRelease, key: 'newborn', label: 'Recién nacido', domain: 'Control por edad', minAgeMonths: '0', maxAgeMonths: '0', sourcePage: 'p. 1' },
    { releaseId: checkupRelease, key: 'day-3-5', label: '3 a 5 días', domain: 'Control por edad', minAgeMonths: '0', maxAgeMonths: '0', minAgeDays: '3', maxAgeDays: '5', sourcePage: 'p. 1' },
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
    expect(rows.pending.map(row => row.key)).toEqual(['fixture-1'])
    expect(rows.pending.every(row => row.badge === 'Borrador - pendiente de revisión')).toBe(true)
    expect(rows.pending[0]).toMatchObject({ minimumInterval: null, sourcePage: 'p. 1', status: 'DRAFT_PENDING_PEDIATRICIAN_REVIEW' })
    expect(rows.pending[0]).toMatchObject({ version: '2026-07' })
    expect(JSON.stringify(rows)).not.toMatch(/recuperación automática|fecha límite|dosis de rescate/i)
  })

  it('rejects an application before the sourced minimum age without writing a dose', async () => {
    await expect(recordDose(doctor, child, { releaseId: release, key: 'fixture-1', appliedAt: '2024-11-30', external: false })).rejects.toMatchObject({ statusCode: 400 })
    expect(await db.select().from(vaccineDose).where(eq(vaccineDose.patientId, child))).toEqual([])
  })

  it('rejects an out-of-order second dose and an interval shorter than the sourced minimum', async () => {
    await expect(recordDose(doctor, intervalChild, { releaseId: release, key: 'fixture-2', appliedAt: '2026-01-02', external: false })).rejects.toMatchObject({ statusCode: 400 })
    await recordDose(doctor, intervalChild, { releaseId: release, key: 'fixture-1', appliedAt: '2026-01-02', external: false })
    const before = await listVaccines(doctor, intervalChild, new Date('2026-01-15T12:00:00Z'))
    expect(before.pending.some(item => item.key === 'fixture-2')).toBe(false)
    await expect(recordDose(doctor, intervalChild, { releaseId: release, key: 'fixture-2', appliedAt: '2026-01-20', external: false })).rejects.toMatchObject({ statusCode: 400 })
    const after = await listVaccines(doctor, intervalChild, new Date('2026-02-02T12:00:00Z'))
    expect(after.pending.some(item => item.key === 'fixture-2')).toBe(true)
  })

  it('keeps sourced bOPV boosters unavailable until the preceding bOPV product dose is recorded', async () => {
    const bopvRelease = '2'.repeat(64)
    await db.insert(catalogRelease).values({ id: bopvRelease, kind: 'VACCINE', publisher: 'MSP Ecuador', title: 'bOPV fixture', version: '2026-bOPV', retrievedAt: '2026-11-16', url: 'https://www.salud.gob.ec/bopv.pdf', sha256: bopvRelease })
    await db.insert(catalogItem).values([
      { releaseId: bopvRelease, key: 'bopv-1', label: 'bOPV oral', domain: 'MSP', minAgeMonths: '6', maxAgeMonths: '6', doseLabel: 'bOPV oral a los 6 meses (IPV en hexavalente)', sourcePage: 'p. 164' },
      { releaseId: bopvRelease, key: 'bopv-2', label: 'bOPV oral', domain: 'MSP', minAgeMonths: '18', maxAgeMonths: '18', doseLabel: 'bOPV oral: primer refuerzo', sourcePage: 'p. 164' },
      { releaseId: bopvRelease, key: 'bopv-3', label: 'bOPV oral', domain: 'MSP', minAgeMonths: '60', maxAgeMonths: '60', doseLabel: 'bOPV oral: segundo refuerzo', sourcePage: 'p. 164' }
    ])
    const older = randomUUID()
    await db.insert(patient).values({ id: older, name: 'Niña bOPV', birthDate: '2020-01-01', sex: 'FEMALE', createdBy: doctor.id })
    expect((await listVaccines(doctor, older)).pending.filter(row => row.key.startsWith('bopv-')).map(row => row.key)).toEqual(['bopv-1'])
    await expect(recordDose(doctor, older, { releaseId: bopvRelease, key: 'bopv-3', appliedAt: '2026-11-16', external: false })).rejects.toMatchObject({ statusCode: 400 })
    await expect(recordDose(doctor, older, { releaseId: bopvRelease, key: 'bopv-2', appliedAt: '2026-11-16', external: false })).rejects.toMatchObject({ statusCode: 400 })
    await recordDose(doctor, older, { releaseId: bopvRelease, key: 'bopv-1', appliedAt: '2026-01-01', external: true })
    expect((await listVaccines(doctor, older)).pending.filter(row => row.key.startsWith('bopv-')).map(row => row.key)).toEqual(['bopv-2'])
    await recordDose(doctor, older, { releaseId: bopvRelease, key: 'bopv-2', appliedAt: '2026-02-01', external: true })
    expect((await listVaccines(doctor, older)).pending.filter(row => row.key.startsWith('bopv-')).map(row => row.key)).toEqual(['bopv-3'])
  })

  it('retains a dose snapshot and private lot after a catalog revision; guardian sees only applied public fields', async () => {
    await expect(recordDose(assistant, child, { releaseId: release, key: 'fixture-1', appliedAt: '2026-01-02', lot: 'PRIVATE_LOT', privateNote: 'PRIVATE_NOTE', external: true })).rejects.toMatchObject({ statusCode: 403 })
    const dose = await recordDose(doctor, child, { releaseId: release, key: 'fixture-1', appliedAt: '2026-01-02', lot: 'PRIVATE_LOT', privateNote: 'PRIVATE_NOTE', external: true })
    expect(dose).toMatchObject({ label: 'Vacuna de prueba', catalogVersion: '2026-07', releaseId: release, external: true, lot: 'PRIVATE_LOT' })
    const revised = 'c'.repeat(64)
    await db.insert(catalogRelease).values({ id: revised, kind: 'VACCINE', publisher: 'MSP Ecuador', title: 'Esquema de prueba', version: '2026-07', revision: revised, publicationDate: null, retrievedAt: '2026-11-16', url: 'https://www.salud.gob.ec/test.pdf', sha256: revised })
    await db.insert(catalogItem).values([{ releaseId: revised, key: 'fixture-1', label: 'Nombre nuevo', domain: 'MSP', minAgeMonths: '12', maxAgeMonths: '12', sourcePage: 'p. 9', doseNumber: '1' }, { releaseId: revised, key: 'fixture-2', label: 'Nombre revisado dos', domain: 'MSP', minAgeMonths: '18', maxAgeMonths: '18', sourcePage: 'p. 9', doseNumber: '2', minimumInterval: '1 mes' }])
    const history = await listVaccines(doctor, child)
    expect(history.pending.some(item => item.key === 'fixture-1')).toBe(false)
    await expect(recordDose(doctor, child, { releaseId: revised, key: 'fixture-1', appliedAt: '2026-01-03', external: false })).rejects.toThrow()
    expect(history.applied[0]).toMatchObject({ label: 'Vacuna de prueba', catalogVersion: '2026-07', sourcePage: 'p. 1' })
    expect(history.pending.some(item => item.key === 'fixture-2')).toBe(true)
    const family = await listAppliedDoses(guardian, child)
    expect(family).toMatchObject([{ label: 'Vacuna de prueba', appliedAt: '2026-01-02' }])
    expect(JSON.stringify(family)).not.toMatch(/PRIVATE_LOT|PRIVATE_NOTE|releaseId|contactPhone|pending/i)
    await expect(listAppliedDoses(stranger, child)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('atomically rejects simultaneous applications of one dose across catalog revisions while retaining distinct keys and sources', async () => {
    const first = '3'.repeat(64)
    const second = '4'.repeat(64)
    const otherSource = '5'.repeat(64)
    const patientId = randomUUID()
    await db.insert(patient).values({ id: patientId, name: 'Niña concurrente', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
    await db.insert(catalogRelease).values([
      { id: first, kind: 'VACCINE', publisher: 'MSP Ecuador', title: 'Primera revisión', version: '2026', retrievedAt: '2026-11-16', url: 'https://www.salud.gob.ec/concurrent.pdf', sha256: first },
      { id: second, kind: 'VACCINE', publisher: 'MSP Ecuador', title: 'Segunda revisión', version: '2026', revision: second, retrievedAt: '2026-11-16', url: 'https://www.salud.gob.ec/concurrent.pdf', sha256: second },
      { id: otherSource, kind: 'VACCINE', publisher: 'Otra fuente', title: 'Otra fuente', version: '2026', retrievedAt: '2026-11-16', url: 'https://example.org/concurrent.pdf', sha256: otherSource }
    ])
    await db.insert(catalogItem).values([first, second, otherSource].flatMap(releaseId => ['shared-1', 'distinct-1'].map(key => ({ releaseId, key, label: key, domain: 'MSP', minAgeMonths: '0', maxAgeMonths: '0', sourcePage: 'p. 1' }))))
    const results = await Promise.allSettled([first, second].map(releaseId => recordDose(doctor, patientId, { releaseId, key: 'shared-1', appliedAt: '2026-01-01', external: true })))
    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect((await db.select().from(vaccineDose).where(eq(vaccineDose.patientId, patientId))).filter(row => row.key === 'shared-1')).toHaveLength(1)
    await recordDose(doctor, patientId, { releaseId: second, key: 'distinct-1', appliedAt: '2026-01-01', external: true })
    await recordDose(doctor, patientId, { releaseId: otherSource, key: 'shared-1', appliedAt: '2026-01-01', external: true })
    expect(await db.select().from(vaccineDose).where(eq(vaccineDose.patientId, patientId))).toHaveLength(3)
  })

  it('backfills existing dose claims during an upgrade and rejects a revised duplicate without altering history', async () => {
    const patientId = randomUUID()
    const oldRelease = '6'.repeat(64)
    const revised = '7'.repeat(64)
    await db.insert(patient).values({ id: patientId, name: 'Niña migración', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
    await db.insert(catalogRelease).values([
      { id: oldRelease, kind: 'VACCINE', publisher: 'MSP Ecuador', title: 'Anterior', version: '2026', retrievedAt: '2026-11-16', url: 'https://www.salud.gob.ec/upgrade.pdf', sha256: oldRelease },
      { id: revised, kind: 'VACCINE', publisher: 'MSP Ecuador', title: 'Revisado', version: '2026', revision: revised, retrievedAt: '2026-11-16', url: 'https://www.salud.gob.ec/upgrade.pdf', sha256: revised }
    ])
    await db.insert(catalogItem).values([{ releaseId: oldRelease, key: 'upgrade-1', label: 'Original', domain: 'MSP', minAgeMonths: '0', maxAgeMonths: '0', sourcePage: 'p. 1' }, { releaseId: revised, key: 'upgrade-1', label: 'Revisada', domain: 'MSP', minAgeMonths: '0', maxAgeMonths: '0', sourcePage: 'p. 2' }])
    const original = await recordDose(doctor, patientId, { releaseId: oldRelease, key: 'upgrade-1', appliedAt: '2026-01-01', external: true, lot: 'original' })
    const migration = readFileSync('./server/db/migrations/0039_dry_invisible_woman.sql', 'utf8')
    await db.execute(sql.raw('DROP TABLE vaccine_dose_claim CASCADE'))
    await db.insert(vaccineDose).values({ id: randomUUID(), patientId, releaseId: revised, key: 'upgrade-1', label: 'Revisada antigua', doseLabel: null, catalogVersion: '2026', sourcePage: 'p. 2', sourceStatus: 'DRAFT_PENDING_PEDIATRICIAN_REVIEW', appliedAt: '2026-01-02', external: true, lot: 'legacy', privateNote: null, authorId: doctor.id })
    for (const statement of migration.split('--> statement-breakpoint')) await db.execute(sql.raw(statement))
    expect((await db.select().from(vaccineDose).where(eq(vaccineDose.patientId, patientId))).map(row => row.label).sort()).toEqual(['Original', 'Revisada antigua'])
    expect((await db.select().from(vaccineDose).where(eq(vaccineDose.id, original.id)))[0]).toMatchObject({ id: original.id, releaseId: oldRelease, label: 'Original', lot: 'original' })
    await expect(recordDose(doctor, patientId, { releaseId: revised, key: 'upgrade-1', appliedAt: '2026-01-02', external: true })).rejects.toThrow()
    expect(await db.select().from(vaccineDose).where(eq(vaccineDose.patientId, patientId))).toHaveLength(2)
  })

  it('rejects a duplicate complementary dose even though its release id is null', async () => {
    const item = await addComplementaryVaccine(doctor, { label: 'Complementaria única', doseLabel: 'Dosis individual', source: 'Criterio médico de prueba', patientId: newborn })
    await recordDose(doctor, newborn, { complementaryId: item!.id, appliedAt: '2026-11-15', external: false })
    await expect(recordDose(doctor, newborn, { complementaryId: item!.id, appliedAt: '2026-11-15', external: false })).rejects.toThrow()
    expect((await listVaccines(doctor, newborn)).applied.filter(row => row.key === item!.id)).toHaveLength(1)
  })

  it('rolls back a dose when the audit insertion fails', async () => {
    const id = 'f'.repeat(64)
    await db.insert(catalogRelease).values({ id, kind: 'VACCINE', publisher: 'Test', title: 'Audit test', version: 'v1', retrievedAt: '2026-11-16', url: 'https://example.org/audit.pdf', sha256: id })
    await db.insert(catalogItem).values({ releaseId: id, key: 'audit-dose', label: 'Dosis auditada', domain: 'MSP', minAgeMonths: '0', maxAgeMonths: '0', sourcePage: 'p. 1' })
    await db.execute(`ALTER TABLE audit_event ADD CONSTRAINT reject_vaccine_audit CHECK (action <> 'VACCINE_DOSE' OR subject_id <> '${newborn}') NOT VALID`)
    try {
      await expect(recordDose(doctor, newborn, { releaseId: id, key: 'audit-dose', appliedAt: '2026-11-15', external: false })).rejects.toThrow()
      expect((await db.select().from(vaccineDose).where(eq(vaccineDose.patientId, newborn))).filter(row => row.key === 'audit-dose')).toEqual([])
    } finally {
      await db.execute('ALTER TABLE audit_event DROP CONSTRAINT reject_vaccine_audit')
    }
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

  it('keeps a pending patient without a verified guardian in review without inventing contact details', async () => {
    const unlinked = randomUUID()
    await db.insert(patient).values({ id: unlinked, name: 'Niña sin contacto', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
    const review = await listVaccinationReview(doctor, new Date('2026-11-16T12:00:00Z'))
    const row = review.find(item => item.id === unlinked)
    expect(row?.pending.some(item => item.kind === 'MSP')).toBe(true)
    expect(row?.contacts).toEqual([])
  })

  it('includes a staff-attested uninvited guardian phone without granting portal access', async () => {
    const uninvited = randomUUID()
    await db.insert(patient).values({ id: uninvited, name: 'Niña contacto presencial', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
    await db.insert(guardianGrant).values({ patientId: uninvited, guardianId: guardian.id, contactEmail: 'guardian-preventive@example.test', contactPhone: '0991234567', proof: 'Identidad verificada presencialmente', verifiedBy: doctor.id, status: 'UNINVITED' })
    const review = await listVaccinationReview(doctor, new Date('2026-11-16T12:00:00Z'))
    expect(review.find(item => item.id === uninvited)?.contacts).toEqual([{ name: 'Representante verificada', phone: '0991234567' }])
    await expect(listAppliedDoses(guardian, uninvited)).rejects.toMatchObject({ statusCode: 404 })
    await db.update(guardianGrant).set({ status: 'REVOKED' }).where(eq(guardianGrant.patientId, uninvited))
    expect((await listVaccinationReview(doctor, new Date('2026-11-16T12:00:00Z'))).find(item => item.id === uninvited)?.contacts).toEqual([])
    await db.update(guardianGrant).set({ status: 'FAILED' }).where(eq(guardianGrant.patientId, uninvited))
    expect((await listVaccinationReview(doctor, new Date('2026-11-16T12:00:00Z'))).find(item => item.id === uninvited)?.contacts).toEqual([])
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
    expect(state.remindersAvailable).toBe(false)
    await recordScreening(doctor, child, 'Instrumento de prueba', { category: 'DEVELOPMENT', appliedAt: '2026-01-03', result: 'Resultado clínico de prueba', privateNote: 'PRIVATE_SCREENING' })
    expect((await listDevelopment(doctor, child)).screenings).toMatchObject([{ instrument: 'Instrumento de prueba', result: 'Resultado clínico de prueba' }])
  })

  it('shows a sourced screening reminder only after its age and keeps an applied test separate', async () => {
    const sourced = 'e'.repeat(64)
    await db.insert(catalogRelease).values({ id: sourced, kind: 'SCREENING', publisher: 'Fuente de prueba', title: 'Tamizaje', version: 'v1', retrievedAt: '2026-11-16', url: 'https://example.org/screening.pdf', sha256: sourced })
    await db.insert(catalogItem).values([{ releaseId: sourced, key: 'development-30', label: 'Tamizaje de desarrollo de prueba', domain: 'DEVELOPMENT', minAgeMonths: '30', maxAgeMonths: '30', sourcePage: 'p. 5' }, { releaseId: sourced, key: 'development-18', label: 'Tamizaje de desarrollo anterior', domain: 'DEVELOPMENT', minAgeMonths: '18', maxAgeMonths: '18', sourcePage: 'p. 4' }])
    await recordScreening(doctor, intervalChild, 'Instrumento anterior', { category: 'DEVELOPMENT', appliedAt: '2025-07-02', result: 'Registrado' })
    expect((await listDevelopment(doctor, intervalChild, new Date('2026-06-30T12:00:00Z'))).reminders).toEqual([])
    const due = await listDevelopment(doctor, intervalChild, new Date('2026-07-01T12:00:00Z'))
    expect(due.remindersAvailable).toBe(true)
    expect(due.reminders).toMatchObject([{ key: 'development-30', ageMonths: 30, badge: 'Borrador - pendiente de revisión', sourcePage: 'p. 5' }])
    await recordScreening(doctor, intervalChild, 'Instrumento de prueba', { category: 'DEVELOPMENT', appliedAt: '2026-07-02', result: 'Registrado' })
    const after = await listDevelopment(doctor, intervalChild, new Date('2026-07-03T12:00:00Z'))
    expect(after.screenings.some(row => row.instrument === 'Instrumento de prueba' && row.result === 'Registrado')).toBe(true)
    expect(after.reminders).toEqual([])
  })

  it('starts a sourced monthly screening reminder on the clamped calendar anniversary, not before', async () => {
    const source = '8'.repeat(64)
    const leapChild = randomUUID()
    await db.insert(patient).values({ id: leapChild, name: 'Niña fin de mes', birthDate: '2024-01-31', sex: 'FEMALE', createdBy: doctor.id })
    await db.insert(catalogRelease).values({ id: source, kind: 'SCREENING', publisher: 'Fuente de prueba', title: 'Tamizaje mensual', version: 'v2', retrievedAt: '2026-11-16', url: 'https://example.org/month-boundary.pdf', sha256: source })
    await db.insert(catalogItem).values([{ releaseId: source, key: 'month-1', label: 'Tamizaje de un mes', domain: 'DEVELOPMENT', minAgeMonths: '1', maxAgeMonths: '1', sourcePage: 'p. 1' }, { releaseId: source, key: 'month-13', label: 'Tamizaje de trece meses', domain: 'LANGUAGE', minAgeMonths: '13', maxAgeMonths: '13', sourcePage: 'p. 2' }])
    expect((await listDevelopment(doctor, leapChild, new Date('2024-02-28T12:00:00Z'))).reminders).toEqual([])
    expect((await listDevelopment(doctor, leapChild, new Date('2024-02-29T12:00:00Z'))).reminders.map(row => row.key)).toEqual(['month-1'])
    expect((await listDevelopment(doctor, leapChild, new Date('2025-02-27T12:00:00Z'))).reminders.map(row => row.key)).toEqual(['month-1'])
    expect((await listDevelopment(doctor, leapChild, new Date('2025-02-28T12:00:00Z'))).reminders.map(row => row.key)).toEqual(['month-1', 'month-13'])
  })

  it('derives newborn and day-window control dates from the patient birth date', async () => {
    const rows = await nextCheckups(newborn, new Date('2026-11-15T12:00:00Z'))
    expect(rows.slice(0, 2)).toMatchObject([{ key: 'newborn', date: '2026-11-15', endDate: '2026-11-15' }, { key: 'day-3-5', date: '2026-11-18', endDate: '2026-11-20' }])
  })

  it('uses only sourced AAP ages and individual overrides, omitting a completed control', async () => {
    const before = await nextCheckups(child)
    expect(before.map(row => row.key)).toEqual(['age-3'])
    expect(before[0]?.date).toBe('2027-01-01')
    expect(before.every(row => row.badge === 'Borrador - pendiente de revisión')).toBe(true)
    await recordCheckup(doctor, child, { releaseId: checkupRelease, key: 'age-2', completedAt: '2026-01-05' })
    await setIndividualCheckup(doctor, child, { date: '2027-02-01', reason: 'Control individual de prueba' })
    const after = await nextCheckups(child)
    expect(after.map(row => row.key)).toEqual(['age-3', null])
    expect(after[1]).toMatchObject({ date: '2027-02-01', reason: 'Control individual de prueba' })
    const revised = 'd'.repeat(64)
    await db.insert(catalogRelease).values({ id: revised, kind: 'CHECKUP', publisher: 'AAP', title: 'Edades de prueba', version: '2025', revision: revised, retrievedAt: '2026-11-16', url: 'https://www.aap.org/test.pdf', sha256: revised })
    await db.insert(catalogItem).values([{ releaseId: revised, key: 'age-2', label: '2 años corregido', domain: 'Control por edad', minAgeMonths: '24', maxAgeMonths: '24', sourcePage: 'p. 2' }, { releaseId: revised, key: 'age-3', label: '3 años corregido', domain: 'Control por edad', minAgeMonths: '36', maxAgeMonths: '36', sourcePage: 'p. 2' }])
    expect((await nextCheckups(child)).map(row => row.key)).toEqual(['age-3', null])
    expect((await nextCheckups(child, new Date('2027-01-02T12:00:00Z'))).map(row => row.key)).toEqual([null])
  })

  it('does not resurrect a completed future control when the same AAP release is revised', async () => {
    await recordCheckup(doctor, newborn, { releaseId: checkupRelease, key: 'age-2', completedAt: '2026-11-16' })
    expect((await nextCheckups(newborn, new Date('2026-11-16T12:00:00Z'))).some(row => row.key === 'age-2')).toBe(false)
    expect((await nextCheckups(newborn, new Date('2026-11-16T12:00:00Z'))).some(row => row.key === 'age-3')).toBe(true)
    const revised = '1'.repeat(64)
    await db.insert(catalogRelease).values({ id: revised, kind: 'CHECKUP', publisher: 'AAP', title: 'Edades de prueba', version: '2025', revision: revised, retrievedAt: '2026-11-16', url: 'https://www.aap.org/test.pdf', sha256: revised })
    await db.insert(catalogItem).values([{ releaseId: revised, key: 'age-2', label: '2 años revisado', domain: 'Control por edad', minAgeMonths: '24', maxAgeMonths: '24', sourcePage: 'p. 2' }, { releaseId: revised, key: 'age-3', label: '3 años revisado', domain: 'Control por edad', minAgeMonths: '36', maxAgeMonths: '36', sourcePage: 'p. 2' }])
    const after = await nextCheckups(newborn, new Date('2026-11-16T12:00:00Z'))
    expect(after.some(row => row.key === 'age-2')).toBe(false)
    expect(after.some(row => row.key === 'age-3')).toBe(true)
  })
})
