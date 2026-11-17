import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import type { Actor } from '../../shared/types/access'
import { appointment, catalogItem, catalogRelease, completedCheckup, individualCheckup, patient, visit } from '../../server/db/schema'
import { eq, sql } from 'drizzle-orm'
import { listPendingControls } from '../../server/services/controls-review'

const source = process.env.DATABASE_URL
if (!source || !new URL(source).pathname.includes('pediatrico')) throw new Error('Dedicated pediatric test server required')
const name = `pediatrico_controls_${randomUUID().replaceAll('-', '')}`
const admin = new URL(source)
admin.pathname = '/postgres'
const target = new URL(source)
target.pathname = `/${name}`
const adminPool = new Pool({ connectionString: admin.href })
const pool = new Pool({ connectionString: target.href })
const db = drizzle(pool)
const previous = process.env.DATABASE_URL
const doctor: Actor = { id: randomUUID(), roles: ['DOCTOR'] }
let created = false

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${name}"`)
  created = true
  process.env.DATABASE_URL = target.href
  await migrate(db, { migrationsFolder: './server/db/migrations' })
}, 120000)
beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE completed_checkup, individual_checkup, catalog_item, catalog_release, clinical_visit, appointment, patient RESTART IDENTITY CASCADE`)
})

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

it('includes overdue individual control without an appointment and displays authored reason', async () => {
  const id = randomUUID()
  await db.insert(patient).values({ id, name: 'Niña pendiente', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
  await db.insert(individualCheckup).values({ id: randomUUID(), patientId: id, date: '2026-01-01', reason: 'Revisión indicada por médico', authorId: doctor.id })
  expect(await listPendingControls(doctor, new Date('2026-02-01T12:00:00Z'))).toMatchObject([{ id, name: 'Niña pendiente', reason: 'Revisión indicada por médico' }])
})

it('keeps a booked control pending until completion is recorded', async () => {
  const id = randomUUID()
  const individualId = randomUUID()
  await db.insert(patient).values({ id, name: 'Niño con cita', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
  await db.insert(individualCheckup).values({ id: individualId, patientId: id, date: '2026-01-01', reason: 'Control individual', authorId: doctor.id })
  const appointmentId = randomUUID()
  await db.insert(appointment).values({ id: appointmentId, patientId: id, name: 'Niño con cita', contact: 'example@test.invalid', reason: '', startsAt: new Date('2026-02-10T12:00:00Z'), endsAt: new Date('2026-02-10T12:30:00Z'), status: 'CONFIRMED', createdBy: doctor.id })
  expect((await listPendingControls(doctor, new Date('2026-02-01T12:00:00Z'))).some(row => row.id === id)).toBe(true)
  await db.update(appointment).set({ status: 'CANCELLED' }).where(eq(appointment.id, appointmentId))
  expect((await listPendingControls(doctor, new Date('2026-02-01T12:00:00Z'))).some(row => row.id === id)).toBe(true)
  await db.insert(completedCheckup).values({ id: randomUUID(), patientId: id, individualId, completedAt: '2026-02-01', authorId: doctor.id })
  expect((await listPendingControls(doctor, new Date('2026-02-02T12:00:00Z'))).some(row => row.id === id)).toBe(false)
})

it('respects latest clinician next-control date and actual subsequent visit', async () => {
  const id = randomUUID()
  await db.insert(patient).values({ id, name: 'Niña visita', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
  const row = { patientId: id, requestId: randomUUID(), requestDigest: 'fixture', measuredAt: new Date('2026-01-01T12:00:00Z'), nextControlAt: new Date('2026-02-15T12:00:00Z'), weightKg: '10', lengthHeightCm: '80', position: 'STANDING', headCircumferenceCm: '45', bmi: '15', correctionUntilMonths: 24, authorId: doctor.id }
  await db.insert(visit).values({ ...row, id: randomUUID() })
  expect((await listPendingControls(doctor, new Date('2026-02-01T12:00:00Z'))).some(item => item.id === id)).toBe(false)
  expect((await listPendingControls(doctor, new Date('2026-02-16T12:00:00Z'))).some(item => item.id === id)).toBe(true)
  await db.insert(visit).values({ ...row, id: randomUUID(), requestId: randomUUID(), measuredAt: new Date('2026-02-16T13:00:00Z'), nextControlAt: null })
  expect((await listPendingControls(doctor, new Date('2026-02-17T12:00:00Z'))).some(item => item.id === id)).toBe(false)
})

it('keeps a clinician due date after an unrelated completed control until a subsequent visit', async () => {
  const id = randomUUID()
  await db.insert(patient).values({ id, name: 'Niña control registrado', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
  await db.insert(visit).values({ id: randomUUID(), patientId: id, requestId: randomUUID(), requestDigest: 'fixture', measuredAt: new Date('2026-01-01T12:00:00Z'), nextControlAt: new Date('2026-01-15T12:00:00Z'), weightKg: '10', lengthHeightCm: '80', position: 'STANDING', headCircumferenceCm: '45', bmi: '15', correctionUntilMonths: 24, authorId: doctor.id })
  expect((await listPendingControls(doctor, new Date('2026-02-01T12:00:00Z'))).some(row => row.id === id)).toBe(true)
  const release = 'a'.repeat(64)
  await db.insert(catalogRelease).values({ id: release, kind: 'CHECKUP', publisher: 'Fixture', title: 'Calendario de prueba', version: '2026', retrievedAt: '2026-01-01', url: 'https://example.test/checkup', sha256: release })
  await db.insert(completedCheckup).values({ id: randomUUID(), patientId: id, releaseId: release, key: 'one', completedAt: '2026-01-20', authorId: doctor.id })
  const individualId = randomUUID()
  await db.insert(individualCheckup).values({ id: individualId, patientId: id, date: '2026-01-10', reason: 'Otra indicación', authorId: doctor.id })
  await db.insert(completedCheckup).values({ id: randomUUID(), patientId: id, individualId, completedAt: '2026-01-22', authorId: doctor.id })
  expect((await listPendingControls(doctor, new Date('2026-02-01T12:00:00Z'))).find(row => row.id === id)).toMatchObject({ reason: 'Próximo control indicado en la visita' })
  await db.insert(visit).values({ id: randomUUID(), patientId: id, requestId: randomUUID(), requestDigest: 'fixture', measuredAt: new Date('2026-01-21T12:00:00Z'), nextControlAt: null, weightKg: '10', lengthHeightCm: '80', position: 'STANDING', headCircumferenceCm: '45', bmi: '15', correctionUntilMonths: 24, authorId: doctor.id })
  expect((await listPendingControls(doctor, new Date('2026-02-01T12:00:00Z'))).some(row => row.id === id)).toBe(false)
})

it('retains a dated recommendation when a later unrelated visit precedes its due date', async () => {
  const id = randomUUID()
  await db.insert(patient).values({ id, name: 'Niña visita temprana', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
  const row = { patientId: id, requestDigest: 'fixture', weightKg: '10', lengthHeightCm: '80', position: 'STANDING', headCircumferenceCm: '45', bmi: '15', correctionUntilMonths: 24, authorId: doctor.id }
  await db.insert(visit).values({ ...row, id: randomUUID(), requestId: randomUUID(), measuredAt: new Date('2026-01-01T12:00:00Z'), nextControlAt: new Date('2026-02-15T12:00:00Z') })
  await db.insert(visit).values({ ...row, id: randomUUID(), requestId: randomUUID(), measuredAt: new Date('2026-01-20T12:00:00Z') })
  expect((await listPendingControls(doctor, new Date('2026-02-16T12:00:00Z'))).find(item => item.id === id)).toMatchObject({ date: '2026-02-15', reason: 'Próximo control indicado en la visita' })
})

it('keeps an older overdue recommendation when an early visit records a newer future date', async () => {
  const id = randomUUID()
  await db.insert(patient).values({ id, name: 'Niña con dos fechas', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
  const row = { patientId: id, requestDigest: 'fixture', weightKg: '10', lengthHeightCm: '80', position: 'STANDING', headCircumferenceCm: '45', bmi: '15', correctionUntilMonths: 24, authorId: doctor.id }
  await db.insert(visit).values({ ...row, id: randomUUID(), requestId: randomUUID(), measuredAt: new Date('2026-01-01T12:00:00Z'), nextControlAt: new Date('2026-02-15T12:00:00Z') })
  await db.insert(visit).values({ ...row, id: randomUUID(), requestId: randomUUID(), measuredAt: new Date('2026-01-20T12:00:00Z'), nextControlAt: new Date('2026-04-01T12:00:00Z') })
  expect((await listPendingControls(doctor, new Date('2026-03-01T12:00:00Z'))).find(item => item.id === id)).toMatchObject({ date: '2026-02-15', reason: 'Próximo control indicado en la visita' })
})

it('does not infer a control from a recommendation whose subsequent visit occurred on its due date', async () => {
  const id = randomUUID()
  await db.insert(patient).values({ id, name: 'Niño atendido en fecha', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
  const row = { patientId: id, requestDigest: 'fixture', weightKg: '10', lengthHeightCm: '80', position: 'STANDING', headCircumferenceCm: '45', bmi: '15', correctionUntilMonths: 24, authorId: doctor.id }
  await db.insert(visit).values({ ...row, id: randomUUID(), requestId: randomUUID(), measuredAt: new Date('2026-01-01T12:00:00Z'), nextControlAt: new Date('2026-02-15T12:00:00Z') })
  await db.insert(visit).values({ ...row, id: randomUUID(), requestId: randomUUID(), measuredAt: new Date('2026-02-15T13:00:00Z') })
  expect((await listPendingControls(doctor, new Date('2026-02-16T12:00:00Z'))).some(item => item.id === id)).toBe(false)
})

it('shows the dated clinician recommendation ahead of older draft catalog windows', async () => {
  const id = randomUUID()
  const releaseId = 'f'.repeat(64)
  await db.insert(patient).values({ id, name: 'Niño con fecha médica', birthDate: '2025-01-01', sex: 'MALE', createdBy: doctor.id })
  await db.insert(catalogRelease).values({ id: releaseId, kind: 'CHECKUP', publisher: 'Fixture', title: 'Calendario', version: '2026', retrievedAt: '2026-01-01', url: 'https://example.test/direct', sha256: releaseId })
  await db.insert(catalogItem).values({ releaseId, key: 'early', label: 'Control de catálogo', domain: 'CHECKUP', minAgeMonths: '12', maxAgeMonths: '24', sourcePage: 'p. 1' })
  await db.insert(visit).values({ id: randomUUID(), patientId: id, requestId: randomUUID(), requestDigest: 'fixture', measuredAt: new Date('2026-01-05T12:00:00Z'), nextControlAt: new Date('2026-01-20T12:00:00Z'), weightKg: '10', lengthHeightCm: '80', position: 'STANDING', headCircumferenceCm: '45', bmi: '15', correctionUntilMonths: 24, authorId: doctor.id })
  expect((await listPendingControls(doctor, new Date('2026-02-01T12:00:00Z'))).find(row => row.id === id)).toMatchObject({ date: '2026-01-20', reason: 'Próximo control indicado en la visita', source: 'Visita médica' })
})

it('keeps an overdue individual instruction visible after a subsequent unrelated visit', async () => {
  const id = randomUUID()
  await db.insert(patient).values({ id, name: 'Niña indicación persistente', birthDate: '2024-06-01', sex: 'FEMALE', createdBy: doctor.id })
  await db.insert(individualCheckup).values({ id: randomUUID(), patientId: id, date: '2026-01-10', reason: 'Control indicado por especialista', authorId: doctor.id })
  await db.insert(visit).values({ id: randomUUID(), patientId: id, requestId: randomUUID(), requestDigest: 'fixture', measuredAt: new Date('2026-01-20T12:00:00Z'), weightKg: '10', lengthHeightCm: '80', position: 'STANDING', headCircumferenceCm: '45', bmi: '15', correctionUntilMonths: 24, authorId: doctor.id })
  expect((await listPendingControls(doctor, new Date('2026-02-01T12:00:00Z'))).find(row => row.id === id)).toMatchObject({ reason: 'Control indicado por especialista', date: '2026-01-10' })
})

it('does not leave a catalog age-window control overdue after its sourced end date', async () => {
  const id = randomUUID()
  const releaseId = 'c'.repeat(64)
  await db.insert(patient).values({ id, name: 'Niña fuera de ventana', birthDate: '2024-01-31', sex: 'FEMALE', createdBy: doctor.id })
  await db.insert(catalogRelease).values({ id: releaseId, kind: 'CHECKUP', publisher: 'Fixture', title: 'Rangos de prueba', version: '2026', retrievedAt: '2026-01-01', url: 'https://example.test/window', sha256: releaseId })
  await db.insert(catalogItem).values({ releaseId, key: 'range', label: 'Control acotado', domain: 'CHECKUP', minAgeMonths: '12', maxAgeMonths: '13', sourcePage: 'p. 2' })
  expect((await listPendingControls(doctor, new Date('2025-02-15T12:00:00Z'))).find(row => row.id === id)).toMatchObject({ date: '2025-01-31', reason: 'Control acotado' })
  expect((await listPendingControls(doctor, new Date('2025-03-01T12:00:00Z'))).some(row => row.id === id)).toBe(false)
})

it('shows a sourced catalog control despite an unrelated visit and future individual entry', async () => {
  const id = randomUUID()
  const releaseId = 'b'.repeat(64)
  await db.insert(patient).values({ id, name: 'Niño calendario', birthDate: '2025-01-01', sex: 'MALE', createdBy: doctor.id })
  await db.insert(catalogRelease).values({ id: releaseId, kind: 'CHECKUP', publisher: 'Fixture', title: 'Controles documentados', version: '2026', retrievedAt: '2026-01-01', url: 'https://example.test/catalog', sha256: releaseId })
  await db.insert(catalogItem).values({ releaseId, key: 'control-12', label: 'Control de 12 meses', domain: 'CHECKUP', minAgeMonths: '12', maxAgeMonths: '14', sourcePage: 'p. 4' })
  await db.insert(visit).values({ id: randomUUID(), patientId: id, requestId: randomUUID(), requestDigest: 'fixture', measuredAt: new Date('2025-07-01T12:00:00Z'), weightKg: '10', lengthHeightCm: '80', position: 'STANDING', headCircumferenceCm: '45', bmi: '15', correctionUntilMonths: 24, authorId: doctor.id })
  await db.insert(individualCheckup).values({ id: randomUUID(), patientId: id, date: '2026-03-01', reason: 'Revisión personal', authorId: doctor.id })
  expect((await listPendingControls(doctor, new Date('2026-02-01T12:00:00Z'))).find(row => row.id === id)).toMatchObject({ date: '2026-01-01', reason: 'Control de 12 meses', source: 'Fixture · Controles documentados · 2026', sourcePage: 'p. 4', badge: 'Borrador - pendiente de revisión' })
  expect((await listPendingControls(doctor, new Date('2026-04-02T12:00:00Z'))).find(row => row.id === id)).toMatchObject({ reason: 'Revisión personal', date: '2026-03-01' })
})

it('uses catalog release identity and key to avoid repeating a documented completion', async () => {
  const id = randomUUID()
  const previous = 'd'.repeat(64)
  const current = 'e'.repeat(64)
  await db.insert(patient).values({ id, name: 'Niño revisión', birthDate: '2025-01-01', sex: 'MALE', createdBy: doctor.id })
  await db.insert(catalogRelease).values({ id: previous, kind: 'CHECKUP', publisher: 'Fixture', title: 'Calendario', version: '2026', revision: 'legacy', retrievedAt: '2026-01-01', url: 'https://example.test/revised', sha256: previous, importedAt: new Date('2026-01-01T12:00:00Z') })
  await db.insert(catalogRelease).values({ id: current, kind: 'CHECKUP', publisher: 'Fixture', title: 'Calendario', version: '2026', revision: 'new', retrievedAt: '2026-01-01', url: 'https://example.test/revised', sha256: current, importedAt: new Date('2026-01-02T12:00:00Z') })
  await db.insert(catalogItem).values({ releaseId: current, key: 'twelve', label: 'Control registrado', domain: 'CHECKUP', minAgeMonths: '12', maxAgeMonths: '14', sourcePage: 'p. 7' })
  expect((await listPendingControls(doctor, new Date('2026-02-01T12:00:00Z'))).find(row => row.id === id)).toMatchObject({ reason: 'Control registrado' })
  await db.insert(completedCheckup).values({ id: randomUUID(), patientId: id, releaseId: previous, key: 'twelve', completedAt: '2026-01-20', authorId: doctor.id })
  expect((await listPendingControls(doctor, new Date('2026-02-01T12:00:00Z'))).some(row => row.id === id)).toBe(false)
})

it('denies assistant, guardian and admin-only access', async () => {
  for (const role of ['ASSISTANT', 'PATIENT', 'ADMIN'] as const) await expect(listPendingControls({ id: randomUUID(), roles: [role] })).rejects.toMatchObject({ statusCode: 403 })
})
