import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { eq, sql } from 'drizzle-orm'
import { Pool } from 'pg'
import type { Actor } from '../../shared/types/access'
import { account, auditEvent, dataRequest, clinicSettings, session, setupToken, user, userRole } from '../../server/db/schema'
import { getClinicSettings, updateClinicSettings, getClinicReportBrand, getPublicClinicBrand } from '../../server/services/clinic-settings'
import { listAudit, exportAuditCsv, listStaff, assignStaffRoles, deactivateStaff, reactivateStaff } from '../../server/services/admin'
import { requestDataAction, listDataRequests, listAllDataRequests, handleDataRequest } from '../../server/services/data-requests'
import { staffInviteSchema } from '../../shared/types/admin'
import { getDoctorPreviewPdf } from '../../server/services/reports'

const source = process.env.DATABASE_URL
if (!source || !new URL(source).pathname.includes('pediatrico')) throw new Error('Dedicated pediatric test server required')
const name = `pediatrico_admin_${randomUUID().replaceAll('-', '')}`
const adminUrl = new URL(source)
adminUrl.pathname = '/postgres'
const target = new URL(source)
target.pathname = `/${name}`
const adminPool = new Pool({ connectionString: adminUrl.href })
const pool = new Pool({ connectionString: target.href })
const db = drizzle(pool)
const previousUrl = process.env.DATABASE_URL
const admin: Actor = { id: randomUUID(), roles: ['ADMIN'] }
const doctor: Actor = { id: randomUUID(), roles: ['DOCTOR'] }
let created = false

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${name}"`)
  created = true
  process.env.DATABASE_URL = target.href
  await migrate(db, { migrationsFolder: './server/db/migrations' })
}, 120000)
beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE data_request, clinic_settings, audit_event, session, user_role, "user" RESTART IDENTITY CASCADE`)
  await db.insert(user).values([{ id: admin.id, name: 'Admin', email: `${admin.id}@example.test` }, { id: doctor.id, name: 'Doctor', email: `${doctor.id}@example.test` }])
  await db.insert(userRole).values([{ userId: admin.id, role: 'ADMIN' }, { userId: doctor.id, role: 'DOCTOR' }])
  await db.insert(account).values({ id: randomUUID(), userId: admin.id, accountId: admin.id, providerId: 'credential', password: 'hashed' })
})
afterAll(async () => {
  process.env.DATABASE_URL = previousUrl
  await pool.end()
  const { useDb } = await import('../../server/utils/db')
  await useDb().$client.end()
  try {
    if (created) await adminPool.query(`DROP DATABASE "${name}"`)
  } finally {
    await adminPool.end()
  }
})

it('keeps the generated migration snapshot aligned with applied WhatsApp tables and constraints', async () => {
  const snapshot = JSON.parse(await readFile('server/db/migrations/meta/0046_snapshot.json', 'utf8'))
  for (const table of ['whatsapp_settings', 'whatsapp_health', 'clinic_settings', 'data_request']) {
    expect(snapshot.tables[`public.${table}`]).toBeDefined()
    const present = await db.execute(sql`select to_regclass(${`public.${table}`}) as name`)
    expect(present.rows[0]?.name).toBe(table)
  }
  expect(snapshot.tables['public.notification_outbox'].checkConstraints.notification_state_ck.value).toContain('NOT_CONFIGURED')
})

it('persists one clinic record, validates accessible primary palette and never returns clinical palette', async () => {
  await expect(updateClinicSettings(doctor, { name: 'Clínica', contactEmail: 'hola@example.test', primary: 'teal', logo: null })).rejects.toMatchObject({ statusCode: 403 })
  const saved = await updateClinicSettings(admin, { name: 'Clínica', contactEmail: 'hola@example.test', primary: 'teal', logo: null })
  expect(saved).toMatchObject({ name: 'Clínica', contactEmail: 'hola@example.test', primary: 'teal', logo: null })
  expect(await getClinicSettings()).toEqual(saved)
  expect(await getClinicReportBrand()).toEqual({ primary: 'teal', logo: '' })
  expect(await db.select().from(clinicSettings)).toHaveLength(1)
  await expect(updateClinicSettings(admin, { name: 'No', contactEmail: 'hola@example.test', primary: '#eeeeee', logo: null })).rejects.toMatchObject({ statusCode: 400 })
  await expect(updateClinicSettings(admin, { name: 'No', contactEmail: 'hola@example.test', primary: 'teal', logo: '../../private' })).rejects.toMatchObject({ statusCode: 400 })
  expect(JSON.stringify(saved)).not.toMatch(/patient|zScore|curve/i)
  expect(await db.select().from(auditEvent).where(eq(auditEvent.action, 'CLINIC_SETTINGS_UPDATE'))).toHaveLength(2)
})

it('uses persisted null logo instead of deployment fallback in reports', async () => {
  const logo = process.env.NUXT_PUBLIC_CLINIC_LOGO
  try {
    process.env.NUXT_PUBLIC_CLINIC_LOGO = '/branding/deployment.png'
    expect(await getClinicReportBrand()).toMatchObject({ logo: '/branding/deployment.png' })
    await updateClinicSettings(admin, { name: 'Clínica', contactEmail: 'hola@example.test', primary: 'teal', logo: null })
    expect(await getClinicReportBrand()).toEqual({ primary: 'teal', logo: '' })
  } finally {
    if (logo === undefined) delete process.env.NUXT_PUBLIC_CLINIC_LOGO
    else process.env.NUXT_PUBLIC_CLINIC_LOGO = logo
  }
})

it('exposes only validated persisted public brand fields and rejects unsafe branding paths', async () => {
  expect(await getPublicClinicBrand()).toEqual({ name: null, primary: 'brand', logo: null })
  await updateClinicSettings(admin, { name: 'Clínica', contactEmail: 'hola@example.test', primary: 'teal', logo: '/branding/clinic.png' })
  expect(await getPublicClinicBrand()).toEqual({ name: 'Clínica', primary: 'teal', logo: '/branding/clinic.png' })
  await expect(updateClinicSettings(admin, { name: 'Clínica', contactEmail: 'hola@example.test', primary: 'teal', logo: '/branding/clinic.svg?url=https://evil.test' })).rejects.toMatchObject({ statusCode: 400 })
  await db.update(clinicSettings).set({ logo: 'https://evil.test/track.png' })
  expect(await getPublicClinicBrand()).toEqual({ name: 'Clínica', primary: 'teal', logo: null })
})

it('validates deployment fallback before exposing public brand values', async () => {
  const primary = process.env.NUXT_PUBLIC_CLINIC_PRIMARY
  const logo = process.env.NUXT_PUBLIC_CLINIC_LOGO
  try {
    process.env.NUXT_PUBLIC_CLINIC_PRIMARY = 'javascript:unsafe'
    process.env.NUXT_PUBLIC_CLINIC_LOGO = 'https://evil.test/logo.png'
    expect(await getPublicClinicBrand()).toEqual({ name: null, primary: 'brand', logo: null })
    process.env.NUXT_PUBLIC_CLINIC_PRIMARY = 'violet'
    process.env.NUXT_PUBLIC_CLINIC_LOGO = '/branding/preprovisioned.webp'
    expect(await getPublicClinicBrand()).toEqual({ name: null, primary: 'violet', logo: '/branding/preprovisioned.webp' })
  } finally {
    if (primary === undefined) delete process.env.NUXT_PUBLIC_CLINIC_PRIMARY
    else process.env.NUXT_PUBLIC_CLINIC_PRIMARY = primary
    if (logo === undefined) delete process.env.NUXT_PUBLIC_CLINIC_LOGO
    else process.env.NUXT_PUBLIC_CLINIC_LOGO = logo
  }
})

it('explicitly grants dual ADMIN and DOCTOR, revokes sessions on deactivation and protects the last administrator', async () => {
  await expect(deactivateStaff(admin, admin.id)).rejects.toMatchObject({ statusCode: 409 })
  await assignStaffRoles(admin, doctor.id, ['ADMIN', 'DOCTOR'])
  await db.insert(account).values({ id: randomUUID(), userId: doctor.id, accountId: doctor.id, providerId: 'credential', password: 'hashed' })
  expect((await listStaff(admin)).find(row => row.id === doctor.id)?.roles).toEqual(['ADMIN', 'DOCTOR'])
  await db.insert(session).values({ id: randomUUID(), userId: doctor.id, token: randomUUID(), expiresAt: new Date(Date.now() + 3600000) })
  await deactivateStaff(admin, doctor.id)
  expect(await db.select().from(session).where(eq(session.userId, doctor.id))).toHaveLength(0)
  expect(await db.select().from(userRole).where(eq(userRole.userId, doctor.id))).toHaveLength(0)
  await expect(assignStaffRoles(doctor, admin.id, ['DOCTOR'])).rejects.toMatchObject({ statusCode: 403 })
})

it('lists deactivated credentialed former staff without exposing unassigned patients or uncredentialed users', async () => {
  const former = randomUUID()
  const patient = randomUUID()
  const uncredentialed = randomUUID()
  await db.insert(user).values([
    { id: former, name: 'Former', email: `${former}@example.test` },
    { id: patient, name: 'Patient', email: `${patient}@example.test` },
    { id: uncredentialed, name: 'Other', email: `${uncredentialed}@example.test` }
  ])
  await db.insert(account).values([
    { id: randomUUID(), userId: former, accountId: former, providerId: 'credential', password: 'hashed' },
    { id: randomUUID(), userId: patient, accountId: patient, providerId: 'credential', password: 'hashed' }
  ])
  await db.insert(userRole).values([{ userId: former, role: 'ASSISTANT' }, { userId: patient, role: 'PATIENT' }])
  await deactivateStaff(admin, former)
  await db.delete(userRole).where(eq(userRole.userId, patient))
  await db.insert(auditEvent).values({ id: randomUUID(), actorId: admin.id, subjectId: uncredentialed, action: 'STAFF_DEACTIVATE', outcome: 'ALLOWED' })
  const staff = await listStaff(admin)
  expect(staff.find(row => row.id === former)).toEqual({ id: former, name: 'Former', email: `${former}@example.test`, roles: [], active: false })
  expect(staff.map(row => row.id)).not.toContain(patient)
  expect(staff.map(row => row.id)).not.toContain(uncredentialed)
  expect(staff.find(row => row.id === admin.id)).toMatchObject({ roles: ['ADMIN'], active: true })
  await expect(listStaff(doctor)).rejects.toMatchObject({ statusCode: 403 })
})

it('does not count an invited administrator without credentials as a functioning administrator', async () => {
  const invited = randomUUID()
  await db.insert(user).values({ id: invited, name: 'Invited', email: `${invited}@example.test` })
  await db.insert(userRole).values({ userId: invited, role: 'ADMIN' })
  await expect(deactivateStaff(admin, admin.id)).rejects.toMatchObject({ statusCode: 409 })
  await expect(assignStaffRoles(admin, admin.id, ['DOCTOR'])).rejects.toMatchObject({ statusCode: 409 })
  expect(await db.select().from(userRole).where(eq(userRole.userId, admin.id))).toMatchObject([{ role: 'ADMIN' }])
})

it('does not count a deactivated credentialed former ADMIN as the last active administrator', async () => {
  const former = randomUUID()
  await db.insert(user).values({ id: former, name: 'Former admin', email: `${former}@example.test` })
  await db.insert(account).values({ id: randomUUID(), userId: former, accountId: former, providerId: 'credential', password: 'hashed' })
  await db.insert(userRole).values({ userId: former, role: 'ADMIN' })
  await deactivateStaff(admin, former)
  expect((await listStaff(admin)).find(row => row.id === former)).toMatchObject({ active: false, roles: [] })
  await expect(deactivateStaff(admin, admin.id)).rejects.toMatchObject({ statusCode: 409 })
  await expect(assignStaffRoles(admin, admin.id, ['DOCTOR'])).rejects.toMatchObject({ statusCode: 409 })
  expect(await db.select().from(userRole).where(eq(userRole.userId, admin.id))).toMatchObject([{ role: 'ADMIN' }])
})

it('rolls back role assignment and sessions if its audit insert fails', async () => {
  const token = randomUUID()
  await db.insert(session).values({ id: randomUUID(), userId: doctor.id, token, expiresAt: new Date(Date.now() + 3600000) })
  await db.execute(sql`ALTER TABLE audit_event ADD CONSTRAINT staff_roles_audit_reject_ck CHECK (action <> 'STAFF_ROLES')`)
  try {
    await expect(assignStaffRoles(admin, doctor.id, ['ASSISTANT'])).rejects.toThrow()
    expect(await db.select().from(userRole).where(eq(userRole.userId, doctor.id))).toMatchObject([{ role: 'DOCTOR' }])
    expect(await db.select().from(session).where(eq(session.userId, doctor.id))).toMatchObject([{ token }])
  } finally {
    await db.execute(sql`ALTER TABLE audit_event DROP CONSTRAINT staff_roles_audit_reject_ck`)
  }
})

it('rolls back request status when its audit insert fails', async () => {
  const request = await requestDataAction(doctor, 'VIEW')
  await db.execute(sql`ALTER TABLE audit_event ADD CONSTRAINT request_handle_audit_reject_ck CHECK (action <> 'DATA_REQUEST_HANDLE')`)
  try {
    await expect(handleDataRequest(admin, request.id, 'UNDER_REVIEW')).rejects.toThrow()
    expect(await db.select().from(dataRequest).where(eq(dataRequest.id, request.id))).toMatchObject([{ status: 'QUEUED', handledBy: null }])
  } finally {
    await db.execute(sql`ALTER TABLE audit_event DROP CONSTRAINT request_handle_audit_reject_ck`)
  }
})

it('rolls back deactivation if its audit insert fails', async () => {
  await db.execute(sql`ALTER TABLE audit_event ADD CONSTRAINT staff_deactivation_audit_reject_ck CHECK (action <> 'STAFF_DEACTIVATE')`)
  try {
    await expect(deactivateStaff(admin, doctor.id)).rejects.toThrow()
    expect(await db.select().from(userRole).where(eq(userRole.userId, doctor.id))).toMatchObject([{ role: 'DOCTOR' }])
  } finally {
    await db.execute(sql`ALTER TABLE audit_event DROP CONSTRAINT staff_deactivation_audit_reject_ck`)
  }
})

it('reactivates only credentialed former staff, revokes sessions and tokens, and audits atomically', async () => {
  const staff = randomUUID()
  await db.insert(user).values({ id: staff, name: 'Former', email: `${staff}@example.test` })
  await db.insert(account).values({ id: randomUUID(), userId: staff, accountId: staff, providerId: 'credential', password: 'hashed' })
  await db.insert(userRole).values({ userId: staff, role: 'ASSISTANT' })
  await deactivateStaff(admin, staff)
  await db.insert(session).values({ id: randomUUID(), userId: staff, token: randomUUID(), expiresAt: new Date(Date.now() + 3600000) })
  await db.insert(setupToken).values({ id: randomUUID(), userId: staff, digest: randomUUID(), purpose: 'RECOVERY', expiresAt: new Date(Date.now() + 3600000) })
  await expect(reactivateStaff(doctor, staff, ['DOCTOR'])).rejects.toMatchObject({ statusCode: 403 })
  expect(await reactivateStaff(admin, staff, ['DOCTOR'])).toEqual({ id: staff, roles: ['DOCTOR'], active: true })
  expect(await db.select().from(session).where(eq(session.userId, staff))).toHaveLength(0)
  expect((await db.select().from(setupToken).where(eq(setupToken.userId, staff)))[0]?.usedAt).toBeInstanceOf(Date)
  expect(await db.select().from(auditEvent).where(eq(auditEvent.action, 'STAFF_REACTIVATE'))).toMatchObject([{ actorId: doctor.id, outcome: 'DENIED' }, { actorId: admin.id, outcome: 'ALLOWED', subjectId: staff }])
  await expect(reactivateStaff(admin, staff, ['ASSISTANT'])).rejects.toMatchObject({ statusCode: 409 })
  await expect(reactivateStaff(admin, randomUUID(), ['DOCTOR'])).rejects.toMatchObject({ statusCode: 404 })
  const invited = randomUUID()
  await db.insert(user).values({ id: invited, name: 'Invited', email: `${invited}@example.test` })
  await expect(reactivateStaff(admin, invited, ['ADMIN'])).rejects.toMatchObject({ statusCode: 409 })
  await db.insert(account).values({ id: randomUUID(), userId: invited, accountId: invited, providerId: 'credential', password: 'hashed' })
  await expect(reactivateStaff(admin, invited, ['ADMIN'])).rejects.toMatchObject({ statusCode: 409 })
})

it('rolls back clinic settings if its audit insert fails', async () => {
  await db.execute(sql`ALTER TABLE audit_event ADD CONSTRAINT clinic_audit_reject_ck CHECK (action <> 'CLINIC_SETTINGS_UPDATE')`)
  try {
    await expect(updateClinicSettings(admin, { name: 'Clínica', contactEmail: 'hola@example.test', primary: 'teal', logo: null })).rejects.toThrow()
    expect(await db.select().from(clinicSettings)).toHaveLength(0)
  } finally {
    await db.execute(sql`ALTER TABLE audit_event DROP CONSTRAINT clinic_audit_reject_ck`)
  }
})

it('paginates a redacted audit whitelist and exports CSV without clinical data', async () => {
  await db.insert(auditEvent).values([
    { id: randomUUID(), actorId: doctor.id, action: 'CLINICAL_READ', outcome: 'ALLOWED', subjectId: randomUUID() },
    { id: randomUUID(), actorId: doctor.id, action: 'REPORT_APPROVE', outcome: 'ALLOWED', subjectId: randomUUID() },
    { id: randomUUID(), actorId: doctor.id, action: 'GUARDIAN_GRANT', outcome: 'ALLOWED', subjectId: randomUUID() }
  ])
  await expect(listAudit(doctor, { page: 1, pageSize: 2 })).rejects.toMatchObject({ statusCode: 403 })
  const page = await listAudit(admin, { page: 1, pageSize: 2 })
  expect(page.total).toBe(4)
  expect(page.items).toHaveLength(2)
  expect(Object.keys(page.items[0]!)).toEqual(['id', 'actorId', 'action', 'subjectId', 'outcome', 'occurredAt'])
  const csv = await exportAuditCsv(admin, { page: 1, pageSize: 2 })
  expect(csv.split('\n')).toHaveLength(5)
  expect(csv).toContain('GUARDIAN_GRANT')
  await expect(exportAuditCsv(doctor, { page: 1, pageSize: 2 })).rejects.toMatchObject({ statusCode: 403 })
})

it('rejects unassigned actors for data requests and staff operations after deactivation', async () => {
  await deactivateStaff(admin, doctor.id)
  await expect(requestDataAction(doctor, 'VIEW')).rejects.toMatchObject({ statusCode: 403 })
  await expect(assignStaffRoles(admin, doctor.id, ['DOCTOR'])).rejects.toMatchObject({ statusCode: 409 })
})

it('denies admin-only clinical PDF export and audits the denied attempt', async () => {
  await expect(getDoctorPreviewPdf(admin, randomUUID(), randomUUID())).rejects.toMatchObject({ statusCode: 403 })
  expect(await db.select().from(auditEvent).where(eq(auditEvent.action, 'REPORT_EXPORT'))).toMatchObject([{ actorId: admin.id, outcome: 'DENIED' }])
})

it('blocks removing the only ADMIN role and preserves their live sessions', async () => {
  const token = randomUUID()
  await db.insert(session).values({ id: randomUUID(), userId: admin.id, token, expiresAt: new Date(Date.now() + 3600000) })
  await expect(assignStaffRoles(admin, admin.id, ['DOCTOR'])).rejects.toMatchObject({ statusCode: 409 })
  expect(await db.select().from(session).where(eq(session.userId, admin.id))).toMatchObject([{ token }])
  expect(await db.select().from(userRole).where(eq(userRole.userId, admin.id))).toMatchObject([{ role: 'ADMIN' }])
})

it('isolates every actor own requests, including ADMIN, and restricts the all-request listing to ADMIN', async () => {
  const pending = await requestDataAction(doctor, 'VIEW')
  const adminRequest = await requestDataAction(admin, 'EXPORT')
  const second = randomUUID()
  await db.insert(user).values({ id: second, name: 'Other', email: `${second}@example.test` })
  await db.insert(userRole).values({ userId: second, role: 'PATIENT' })
  const patient: Actor = { id: second, roles: ['PATIENT'] }
  const patientRequest = await requestDataAction(patient, 'DELETE')
  expect((await listDataRequests(doctor)).map(row => row.id)).toEqual([pending.id])
  expect((await listDataRequests(admin)).map(row => row.id)).toEqual([adminRequest.id])
  expect((await listDataRequests(patient)).map(row => row.id)).toEqual([patientRequest.id])
  await expect(listAllDataRequests(doctor)).rejects.toMatchObject({ statusCode: 403 })
  await expect(listAllDataRequests(patient)).rejects.toMatchObject({ statusCode: 403 })
  expect((await listAllDataRequests(admin)).items.map(row => row.id).sort()).toEqual([pending.id, adminRequest.id, patientRequest.id].sort())
  expect(await db.select().from(auditEvent).where(eq(auditEvent.action, 'DATA_REQUEST'))).toHaveLength(3)
})

it('exposes requests older than the first 100 through bounded admin pages', async () => {
  await db.insert(dataRequest).values(Array.from({ length: 101 }, (_, index) => ({ id: randomUUID(), requesterId: doctor.id, type: 'VIEW' as const, createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)), updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)) })))
  const first = await listAllDataRequests(admin, 1)
  const second = await listAllDataRequests(admin, 2)
  expect(first.items).toHaveLength(100)
  expect(second.items).toHaveLength(1)
  expect(first.total).toBe(101)
  expect(second.items[0]?.id).not.toBe(first.items[0]?.id)
  await expect(listAllDataRequests(admin, 0)).rejects.toMatchObject({ statusCode: 400 })
})

it('escapes spreadsheet formulas in redacted audit CSV and applies filters', async () => {
  await db.insert(auditEvent).values([{ id: randomUUID(), actorId: doctor.id, action: '=HYPERLINK("unsafe")', outcome: 'DENIED' }, { id: randomUUID(), actorId: doctor.id, action: 'VISIT_READ', outcome: 'ALLOWED' }])
  const csv = await exportAuditCsv(admin, { page: 1, pageSize: 10, outcome: 'DENIED' })
  expect(csv).toContain(`'=HYPERLINK`)
  expect(csv).not.toContain('VISIT_READ')
  expect((await listAudit(admin, { page: 1, pageSize: 10, outcome: 'DENIED' })).items).toHaveLength(1)
})

it('requires explicit ADMIN assignment on staff invitations instead of inferring it from DOCTOR', () => {
  expect(staffInviteSchema.safeParse({ email: 'a@example.test', name: 'A', roles: ['ADMIN', 'DOCTOR'] }).success).toBe(true)
  expect(staffInviteSchema.safeParse({ email: 'a@example.test', name: 'A', roles: ['PATIENT'] }).success).toBe(false)
})

it('queues only authenticated own data actions, records audit and allows admin review without automatic export/deletion', async () => {
  const request = await requestDataAction(doctor, 'DELETE')
  expect(request).toMatchObject({ requesterId: doctor.id, type: 'DELETE', status: 'QUEUED' })
  expect(await db.select().from(dataRequest)).toHaveLength(1)
  expect(await db.select().from(auditEvent).where(eq(auditEvent.action, 'DATA_REQUEST'))).toMatchObject([{ actorId: doctor.id, outcome: 'ALLOWED', subjectId: request.id }])
  expect((await listDataRequests(doctor)).map(row => row.id)).toEqual([request.id])
  expect(await listDataRequests(admin)).toEqual([])
  expect((await listAllDataRequests(admin)).items.map(row => row.id)).toEqual([request.id])
  await expect(handleDataRequest(doctor, request.id, 'UNDER_REVIEW')).rejects.toMatchObject({ statusCode: 403 })
  expect(await handleDataRequest(admin, request.id, 'UNDER_REVIEW')).toMatchObject({ status: 'UNDER_REVIEW' })
  expect(await db.select().from(user).where(eq(user.id, doctor.id))).toHaveLength(1)
  await expect(requestDataAction(doctor, 'PURGE' as 'DELETE')).rejects.toMatchObject({ statusCode: 400 })
  expect(await handleDataRequest(admin, request.id, 'CLOSED')).toMatchObject({ status: 'CLOSED' })
})
