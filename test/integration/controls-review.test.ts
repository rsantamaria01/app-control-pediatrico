import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import type { Actor } from '../../shared/types/access'
import { appointment, completedCheckup, individualCheckup, patient, visit } from '../../server/db/schema'
import { eq } from 'drizzle-orm'
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

it('hides an active appointment without marking the control complete, and completion clears it', async () => {
  const id = randomUUID()
  const individualId = randomUUID()
  await db.insert(patient).values({ id, name: 'Niño con cita', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
  await db.insert(individualCheckup).values({ id: individualId, patientId: id, date: '2026-01-01', reason: 'Control individual', authorId: doctor.id })
  const appointmentId = randomUUID()
  await db.insert(appointment).values({ id: appointmentId, patientId: id, name: 'Niño con cita', contact: 'example@test.invalid', reason: '', startsAt: new Date('2026-02-10T12:00:00Z'), endsAt: new Date('2026-02-10T12:30:00Z'), status: 'CONFIRMED', createdBy: doctor.id })
  expect((await listPendingControls(doctor, new Date('2026-02-01T12:00:00Z'))).some(row => row.id === id)).toBe(false)
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

it('clears a clinician due date after a qualifying completed control without a second visit', async () => {
  const id = randomUUID()
  await db.insert(patient).values({ id, name: 'Niña control registrado', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
  await db.insert(visit).values({ id: randomUUID(), patientId: id, requestId: randomUUID(), requestDigest: 'fixture', measuredAt: new Date('2026-01-01T12:00:00Z'), nextControlAt: new Date('2026-01-15T12:00:00Z'), weightKg: '10', lengthHeightCm: '80', position: 'STANDING', headCircumferenceCm: '45', bmi: '15', correctionUntilMonths: 24, authorId: doctor.id })
  expect((await listPendingControls(doctor, new Date('2026-02-01T12:00:00Z'))).some(row => row.id === id)).toBe(true)
  const release = 'a'.repeat(64)
  const { catalogRelease } = await import('../../server/db/schema')
  await db.insert(catalogRelease).values({ id: release, kind: 'CHECKUP', publisher: 'Fixture', title: 'Calendario de prueba', version: '2026', retrievedAt: '2026-01-01', url: 'https://example.test/checkup', sha256: release })
  await db.insert(completedCheckup).values({ id: randomUUID(), patientId: id, releaseId: release, key: 'one', completedAt: '2026-01-20', authorId: doctor.id })
  expect((await listPendingControls(doctor, new Date('2026-02-01T12:00:00Z'))).some(row => row.id === id)).toBe(false)
})

it('denies assistant, guardian and admin-only access', async () => {
  for (const role of ['ASSISTANT', 'PATIENT', 'ADMIN'] as const) await expect(listPendingControls({ id: randomUUID(), roles: [role] })).rejects.toMatchObject({ statusCode: 403 })
})
