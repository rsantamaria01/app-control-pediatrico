import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createServer, type Socket } from 'node:net'
import { readFile } from 'node:fs/promises'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { and, eq } from 'drizzle-orm'
import { Pool } from 'pg'
import { account, auditEvent, guardianDelivery, guardianGrant, guardianPhone, patient, patientContactIntake, setupToken, user, userRole, visit, visitResult, visitText } from '../../server/db/schema'
import type { Actor } from '../../shared/types/access'

const configured = process.env.TEST_DATABASE_URL
if (!configured || new URL(configured).pathname !== '/pediatrico_auth_slice2_test' || configured === process.env.DATABASE_URL) throw new Error('Dedicated auth test database required')
const name = `pediatrico_guardian_${randomUUID().replace(/-/g, '')}`
const target = new URL(configured)
target.pathname = `/${name}`
const admin = new URL(configured)
admin.pathname = '/postgres'
const adminPool = new Pool({ connectionString: admin.href })
const pool = new Pool({ connectionString: target.href })
const db = drizzle(pool)
const previous = process.env.DATABASE_URL
const sockets = new Set<Socket>()
const mails: string[] = []
let failDelivery = false
let collecting = false
let content = ''
const smtp = createServer((socket) => {
  sockets.add(socket)
  socket.on('close', () => sockets.delete(socket))
  socket.write('220 mail.test ESMTP\r\n')
  socket.on('data', (chunk) => {
    const text = chunk.toString()
    if (collecting) {
      content += text
      if (content.endsWith('\r\n.\r\n')) {
        collecting = false
        mails.push(content)
        socket.write('250 Accepted\r\n')
      }
    } else if (text.startsWith('EHLO')) socket.write('250 mail.test\r\n')
    else if (text.startsWith('RCPT TO')) socket.write(failDelivery ? '550 Rejected\r\n' : '250 OK\r\n')
    else if (text.startsWith('MAIL FROM')) socket.write('250 OK\r\n')
    else if (text.startsWith('DATA')) {
      content = ''
      collecting = true
      socket.write('354 Continue\r\n')
    } else if (text.startsWith('QUIT')) socket.end('221 Bye\r\n')
  })
})
const doctor: Actor = { id: randomUUID(), roles: ['DOCTOR'] }
const assistant: Actor = { id: randomUUID(), roles: ['ASSISTANT'] }
const adminActor: Actor = { id: randomUUID(), roles: ['ADMIN'] }
const guardianId = randomUUID()
const otherId = randomUUID()
const first = randomUUID()
const second = randomUUID()
let created = false

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${name}"`)
  created = true
  process.env.DATABASE_URL = target.href
  await migrate(db, { migrationsFolder: './server/db/migrations' })
  await new Promise<void>(resolve => smtp.listen(0, '127.0.0.1', resolve))
  process.env.SMTP_HOST = '127.0.0.1'
  process.env.SMTP_PORT = String((smtp.address() as { port: number }).port)
  process.env.SMTP_SECURE = 'false'
  process.env.SMTP_FROM = 'test@localhost'
  process.env.NUXT_PUBLIC_SITE_URL = 'http://localhost:3000'
  process.env.RECOVERY_QUEUE_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  await db.insert(patient).values([
    { id: first, name: 'Niña A', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id },
    { id: second, name: 'Niño B', birthDate: '2019-01-01', sex: 'MALE', createdBy: doctor.id }
  ])
  await db.insert(user).values([{ id: otherId, name: 'Otra familia', email: 'other-guardian@example.test', username: 'other-guardian' }])
  await db.insert(userRole).values({ userId: otherId, role: 'PATIENT' })
}, 120000)
afterAll(async () => {
  process.env.DATABASE_URL = previous
  await pool.end()
  const { useDb } = await import('../../server/utils/db')
  await useDb().$client.end()
  for (const socket of sockets) socket.destroy()
  await new Promise<void>(resolve => smtp.close(() => resolve()))
  try {
    if (created) await adminPool.query(`DROP DATABASE "${name}"`)
  } finally {
    await adminPool.end()
  }
})

function latestToken() {
  const token = mails.at(-1)?.match(/invitacion\/([a-zA-Z0-9_-]{32,})/)?.[1]
  expect(token).toBeTruthy()
  return token!
}

async function seedVisit(patientId: string, shareWithFamily = true) {
  const id = randomUUID()
  await db.insert(visit).values({ id, patientId, requestId: randomUUID(), requestDigest: 'fixture', measuredAt: new Date('2025-01-01T12:00:00Z'), weightKg: '9', lengthHeightCm: '75', position: 'RECUMBENT', headCircumferenceCm: '45', bmi: '16', correctionUntilMonths: 24, authorId: doctor.id, shareWithFamily })
  await db.insert(visitText).values({ visitId: id, privateNote: 'PRIVATE_SECRET', parentAdvice: 'Conversar en consulta', clinicianTrend: 'PRIVATE_TREND' })
  await db.insert(visitResult).values({ id: randomUUID(), visitId: id, indicator: 'WEIGHT_FOR_AGE', snapshot: { status: 'unavailable', reason: 'Referencia no disponible' }, calculatedBy: doctor.id })
  return id
}

describe('verified guardian isolation', () => {
  it('migration canonicalizes an existing single mixed-case user, grant and intake without losing their links', async () => {
    const id = randomUUID()
    const child = randomUUID()
    const intake = randomUUID()
    const email = `${randomUUID()}@example.test`
    const mixed = email.toUpperCase()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('ALTER TABLE "user" DROP CONSTRAINT user_email_canonical_ck')
      await client.query('DROP INDEX user_email_canonical_idx')
      await client.query('ALTER TABLE guardian_grant DROP CONSTRAINT guardian_grant_email_canonical_ck')
      await client.query('ALTER TABLE patient_contact_intake DROP CONSTRAINT patient_contact_email_canonical_ck')
      await client.query('INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)', [id, 'Familia existente', mixed])
      await client.query('INSERT INTO patient (id, name, birth_date, sex, created_by) VALUES ($1,$2,$3,$4,$5)', [child, 'Niña existente', '2024-01-01', 'FEMALE', doctor.id])
      await client.query('INSERT INTO guardian_grant (patient_id, guardian_id, contact_email, proof, verified_by, status) VALUES ($1,$2,$3,$4,$5,$6)', [child, id, mixed, 'Identidad verificada', doctor.id, 'ACTIVE'])
      await client.query('INSERT INTO patient_contact_intake (id, patient_id, position, name, relationship, phone, email, proof, invite, status, guardian_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [intake, child, 0, 'Familia existente', 'Madre', '0991234567', mixed, '', false, 'LINKED', id, doctor.id])
      const script = await readFile('server/db/migrations/0025_slow_princess_powerful.sql', 'utf8')
      await client.query(script.replaceAll('--> statement-breakpoint', ''))
      expect((await client.query('SELECT email FROM "user" WHERE id = $1', [id])).rows[0]?.email).toBe(email)
      expect((await client.query('SELECT guardian_id, contact_email FROM guardian_grant WHERE patient_id = $1', [child])).rows[0]).toMatchObject({ guardian_id: id, contact_email: email })
      expect((await client.query('SELECT guardian_id, email FROM patient_contact_intake WHERE id = $1', [intake])).rows[0]).toMatchObject({ guardian_id: id, email })
      await expect(client.query('INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)', [randomUUID(), 'Duplicado', mixed])).rejects.toThrow()
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
  })

  it('migration refuses preexisting canonical collisions without deleting users or changing family grants', async () => {
    const a = randomUUID()
    const b = randomUUID()
    const child = randomUUID()
    const email = `${randomUUID()}@example.test`
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('ALTER TABLE "user" DROP CONSTRAINT user_email_canonical_ck')
      await client.query('DROP INDEX user_email_canonical_idx')
      await client.query('ALTER TABLE guardian_grant DROP CONSTRAINT guardian_grant_email_canonical_ck')
      await client.query('ALTER TABLE patient_contact_intake DROP CONSTRAINT patient_contact_email_canonical_ck')
      await client.query('INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3),($4,$5,$6)', [a, 'Familia uno', email, b, 'Familia dos', email.toUpperCase()])
      await client.query('INSERT INTO patient (id, name, birth_date, sex, created_by) VALUES ($1,$2,$3,$4,$5)', [child, 'Niña aislada', '2024-01-01', 'FEMALE', doctor.id])
      await client.query('INSERT INTO guardian_grant (patient_id, guardian_id, contact_email, proof, verified_by, status) VALUES ($1,$2,$3,$4,$5,$6)', [child, a, email.toUpperCase(), 'Evidencia documental', doctor.id, 'ACTIVE'])
      const script = await readFile('server/db/migrations/0025_slow_princess_powerful.sql', 'utf8')
      await expect(client.query(script.replaceAll('--> statement-breakpoint', ''))).rejects.toThrow('Canonical email collision')
      await client.query('ROLLBACK')
      expect(await db.select().from(user).where(eq(user.id, a))).toHaveLength(0)
      expect(await db.select().from(user).where(eq(user.id, b))).toHaveLength(0)
      expect(await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, child))).toHaveLength(0)
    } finally {
      client.release()
    }
  })

  it('refuses to resolve pre-migration canonical duplicates to an arbitrary family', async () => {
    const { findGuardianIdentity } = await import('../../server/services/invitations')
    const email = `${randomUUID()}@example.test`
    const a = randomUUID()
    const b = randomUUID()
    await pool.query('ALTER TABLE "user" DROP CONSTRAINT user_email_canonical_ck')
    await pool.query('DROP INDEX user_email_canonical_idx')
    try {
      await db.insert(user).values([{ id: a, name: 'Familia una', email }, { id: b, name: 'Familia otra', email: email.toUpperCase() }])
      await expect(findGuardianIdentity(doctor, { email })).rejects.toMatchObject({ statusCode: 409 })
    } finally {
      await db.delete(user).where(eq(user.id, a))
      await db.delete(user).where(eq(user.id, b))
      await pool.query('CREATE UNIQUE INDEX user_email_canonical_idx ON "user" (lower(btrim(email)))')
      await pool.query('ALTER TABLE "user" ADD CONSTRAINT user_email_canonical_ck CHECK (email = lower(btrim(email)))')
    }
  })

  it('does not let mismatched case or spacing bypass guardian identity confirmation', async () => {
    const { findGuardianIdentity, grantGuardian } = await import('../../server/services/invitations')
    const email = `${randomUUID()}@example.test`
    const id = randomUUID()
    const child = randomUUID()
    await db.insert(user).values({ id, name: 'Familia existente', email })
    await db.insert(userRole).values({ userId: id, role: 'PATIENT' })
    await db.insert(patient).values({ id: child, name: 'Niño aislado', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
    expect((await findGuardianIdentity(doctor, { email: ` ${email.toUpperCase()} ` }))?.id).toBe(id)
    await expect(grantGuardian(doctor, child, { name: 'Familia existente', email: email.toUpperCase(), proof: 'Identidad revisada presencialmente' })).rejects.toMatchObject({ statusCode: 409 })
    expect(await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, child))).toHaveLength(0)
    const result = await grantGuardian(doctor, child, { name: 'Familia existente', email: email.toUpperCase(), confirmedGuardianId: id, proof: 'Identidad revisada presencialmente', deferDelivery: true })
    expect(result.status).toBe('UNINVITED')
    expect((await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, child)))[0]?.guardianId).toBe(id)
  })

  it('rejects a differently cased second account at the database boundary, preserving the first guardian', async () => {
    const email = `${randomUUID()}@example.test`
    const id = randomUUID()
    await db.insert(user).values({ id, name: 'Familia original', email })
    await expect(db.insert(user).values({ id: randomUUID(), name: 'Familia distinta', email: email.toUpperCase() })).rejects.toThrow()
    expect((await db.select({ id: user.id }).from(user).where(eq(user.id, id)))).toHaveLength(1)
  })

  it('normalizes a mixed-case quick-create email and links the confirmed existing guardian to only this child', async () => {
    const { createQuickPatient, listPendingContacts } = await import('../../server/services/patients')
    const { listShareableChildren } = await import('../../server/services/invitations')
    const email = `${randomUUID()}@example.test`
    const mixed = `  ${email.toUpperCase()}  `
    const phone = `09${randomUUID().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`
    const id = randomUUID()
    await db.insert(user).values({ id, name: 'Representante confirmado', email })
    await db.insert(userRole).values({ userId: id, role: 'PATIENT' })
    await db.insert(guardianPhone).values({ guardianId: id, phone })
    const result = await createQuickPatient(doctor, { givenNames: 'Hijo', surnames: `Nuevo${randomUUID().slice(0, 8)}`, birthDate: '2024-04-01', sex: 'MALE', contacts: [{ name: 'Representante confirmado', relationship: 'Madre', phone, email: mixed, proof: 'Identidad confirmada presencialmente', confirmedGuardianId: id, invite: false }] })
    expect(result.contacts[0]?.status).toBe('UNINVITED')
    expect(await listPendingContacts(doctor, result.patient.id)).toEqual([])
    const [intake] = await db.select().from(patientContactIntake).where(eq(patientContactIntake.patientId, result.patient.id))
    const [grant] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, result.patient.id))
    expect(intake?.email).toBe(email)
    expect(grant).toMatchObject({ guardianId: id, contactEmail: email, status: 'UNINVITED' })
    expect(await db.select().from(user).where(eq(user.email, email))).toHaveLength(1)
    expect(await listShareableChildren({ id, roles: ['PATIENT'] })).toEqual([])
    expect(await listShareableChildren({ id: otherId, roles: ['PATIENT'] })).toEqual([])
  })

  it('retries an old mixed-case intake row using its canonical email without changing the verified family', async () => {
    const { retryPendingContact, listPendingContacts } = await import('../../server/services/patients')
    const email = `${randomUUID()}@example.test`
    const guardianId = randomUUID()
    const childId = randomUUID()
    const intakeId = randomUUID()
    const phone = `09${randomUUID().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`
    await db.insert(user).values({ id: guardianId, name: 'Representante previo', email })
    await db.insert(userRole).values({ userId: guardianId, role: 'PATIENT' })
    await db.insert(guardianPhone).values({ guardianId, phone })
    await db.insert(patient).values({ id: childId, name: 'Niño con contacto previo', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('ALTER TABLE patient_contact_intake DROP CONSTRAINT patient_contact_email_canonical_ck')
      await client.query('INSERT INTO patient_contact_intake (id, patient_id, position, name, relationship, phone, email, proof, invite, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [intakeId, childId, 0, 'Representante previo', 'Madre', phone, email.toUpperCase(), 'Identidad previamente verificada', false, doctor.id])
      await client.query('COMMIT')
    } finally {
      client.release()
    }
    try {
      await expect(retryPendingContact(doctor, childId, intakeId, {})).rejects.toMatchObject({ statusCode: 409 })
      const linked = await retryPendingContact(doctor, childId, intakeId, { confirmedGuardianId: guardianId })
      expect(linked.status).toBe('UNINVITED')
      expect((await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, childId)))[0]?.guardianId).toBe(guardianId)
      expect(await listPendingContacts(doctor, childId)).toEqual([])
    } finally {
      await pool.query('ALTER TABLE patient_contact_intake ADD CONSTRAINT patient_contact_email_canonical_ck CHECK (email IS NULL OR email = lower(btrim(email)))')
    }
  })

  it('normalizes mixed-case email when retrying a pending contact with explicit guardian confirmation', async () => {
    const { retryPendingContact, listPendingContacts } = await import('../../server/services/patients')
    const email = `${randomUUID()}@example.test`
    const mixed = `  ${email.toUpperCase()}  `
    const phone = `09${randomUUID().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`
    const id = randomUUID()
    const childId = randomUUID()
    const intakeId = randomUUID()
    await db.insert(user).values({ id, name: 'Familia verificada', email })
    await db.insert(userRole).values({ userId: id, role: 'PATIENT' })
    await db.insert(guardianPhone).values({ guardianId: id, phone })
    await db.insert(patient).values({ id: childId, name: 'Niño pendiente', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
    await db.insert(patientContactIntake).values({ id: intakeId, patientId: childId, position: 0, name: 'Familia verificada', relationship: 'Madre', phone, email, proof: 'Identidad verificada presencialmente', invite: false, createdBy: doctor.id })
    await expect(retryPendingContact(doctor, childId, intakeId, { email: mixed, proof: 'Identidad revisada presencialmente' })).rejects.toMatchObject({ statusCode: 409 })
    expect((await listPendingContacts(doctor, childId))[0]?.email).toBe(email)
    expect(await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, childId))).toHaveLength(0)
    const result = await retryPendingContact(doctor, childId, intakeId, { confirmedGuardianId: id })
    expect(result.status).toBe('UNINVITED')
    expect((await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, childId)))[0]).toMatchObject({ guardianId: id, contactEmail: email })
    expect(await listPendingContacts(doctor, childId)).toEqual([])
  })
  it('reconciles an ACTIVE guardian after a post-commit audit failure without exposing a false pending contact', async () => {
    const { createQuickPatient, listPendingContacts } = await import('../../server/services/patients')
    const { getShareableChild } = await import('../../server/services/invitations')
    const guardianId = randomUUID()
    const email = `${randomUUID()}@example.test`
    const phone = `09${randomUUID().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`
    await db.insert(user).values({ id: guardianId, name: 'Familia ya activa', email })
    await db.insert(userRole).values({ userId: guardianId, role: 'PATIENT' })
    await db.insert(guardianPhone).values({ guardianId, phone })
    await db.insert(account).values({ id: randomUUID(), accountId: guardianId, userId: guardianId, providerId: 'credential', password: 'existing hashed credential' })
    await pool.query(`CREATE FUNCTION fail_grant_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'GUARDIAN_GRANT' AND NEW.actor_id = '${doctor.id}' AND NEW.outcome = 'ALLOWED' THEN RAISE EXCEPTION 'postcommit audit failure'; END IF; RETURN NEW; END $$`)
    await pool.query('CREATE TRIGGER fail_grant_audit BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION fail_grant_audit()')
    try {
      const result = await createQuickPatient(doctor, { givenNames: 'Hija', surnames: `Activa${randomUUID().slice(0, 8)}`, birthDate: '2024-06-01', sex: 'FEMALE', contacts: [{ name: 'Familia ya activa', relationship: 'Madre', phone, email, proof: 'Identidad confirmada presencialmente', invite: true, confirmedGuardianId: guardianId }] })
      expect(result.contacts[0]?.status).toBe('ACTIVE')
      const [grant] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, result.patient.id))
      expect(grant?.status).toBe('ACTIVE')
      expect(await listPendingContacts(doctor, result.patient.id)).toEqual([])
      expect((await getShareableChild({ id: guardianId, roles: ['PATIENT'] }, result.patient.id)).name).toBe(result.patient.name)
    } finally {
      await pool.query('DROP TRIGGER fail_grant_audit ON audit_event')
      await pool.query('DROP FUNCTION fail_grant_audit()')
    }
  })

  it('does not change a pending contact after recovery has already linked it', async () => {
    const { retryPendingContact, listPendingContacts } = await import('../../server/services/patients')
    const patientId = randomUUID()
    const intakeId = randomUUID()
    const phone = `09${randomUUID().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`
    await db.insert(patient).values({ id: patientId, name: 'Contacto ya vinculado', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
    await db.insert(patientContactIntake).values({ id: intakeId, patientId, position: 0, name: 'Familia', relationship: 'Madre', phone, email: null, proof: 'Identidad comprobada presencialmente', invite: false, createdBy: doctor.id })
    await retryPendingContact(doctor, patientId, intakeId, {})
    await expect(retryPendingContact(doctor, patientId, intakeId, { email: `${randomUUID()}@example.test`, proof: 'Cambio posterior verificado' })).rejects.toMatchObject({ statusCode: 404 })
    expect(await listPendingContacts(doctor, patientId)).toEqual([])
  })

  it('does not let assistant or unrelated guardian details mark a pending patient contact linked', async () => {
    const { grantGuardian } = await import('../../server/services/invitations')
    const childId = randomUUID()
    const intakeId = randomUUID()
    const phone = `09${randomUUID().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`
    await db.insert(patient).values({ id: childId, name: 'Contacto protegido', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
    await db.insert(patientContactIntake).values({ id: intakeId, patientId: childId, position: 0, name: 'Madre verificada', relationship: 'Madre', phone, email: null, proof: 'Evidencia original verificada', invite: false, createdBy: doctor.id })
    await expect(grantGuardian(adminActor, childId, { name: 'Otro familiar', relationship: 'Padre', phone: `09${randomUUID().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`, proof: 'Identidad vista presencialmente', intakeId })).rejects.toMatchObject({ statusCode: 403 })
    await expect(grantGuardian(doctor, childId, { name: 'Otro familiar', relationship: 'Padre', phone: `09${randomUUID().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`, proof: 'Identidad vista presencialmente', intakeId })).rejects.toMatchObject({ statusCode: 409 })
    expect((await db.select().from(patientContactIntake).where(eq(patientContactIntake.id, intakeId)))[0]?.status).toBe('LINK_FAILED')
    expect(await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, childId))).toHaveLength(0)
  })

  it('reconciles a committed grant after delivery processing fails and keeps pending contacts hidden', async () => {
    const { createQuickPatient, listPendingContacts } = await import('../../server/services/patients')
    const email = `${randomUUID()}@example.test`
    const phone = `09${randomUUID().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`
    await pool.query(`CREATE FUNCTION fail_delivery_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state = 'SENDING' THEN RAISE EXCEPTION 'delivery claim failed'; END IF; RETURN NEW; END $$`)
    await pool.query('CREATE TRIGGER fail_delivery_claim BEFORE UPDATE ON guardian_delivery FOR EACH ROW EXECUTE FUNCTION fail_delivery_claim()')
    try {
      const result = await createQuickPatient(doctor, { givenNames: 'Envío', surnames: `Guardado${randomUUID().slice(0, 8)}`, birthDate: '2024-06-01', sex: 'FEMALE', contacts: [{ name: 'Familia', relationship: 'Madre', phone, email, proof: 'Identidad confirmada presencialmente', invite: true }] })
      const [grant] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, result.patient.id))
      expect(result.contacts[0]?.status).not.toBe('LINK_FAILED')
      expect(grant?.status).toBe('FAILED')
      expect(await listPendingContacts(doctor, result.patient.id)).toEqual([])
      expect((await db.select().from(patientContactIntake).where(eq(patientContactIntake.patientId, result.patient.id)))[0]).toMatchObject({ status: 'LINKED', guardianId: grant?.guardianId })
    } finally {
      await pool.query('DROP TRIGGER fail_delivery_claim ON guardian_delivery')
      await pool.query('DROP FUNCTION fail_delivery_claim()')
    }
  })

  it('does not report a committed guardian link as failed when intake status update fails', async () => {
    const { createQuickPatient, listPendingContacts } = await import('../../server/services/patients')
    const phone = `09${randomUUID().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`
    await pool.query(`CREATE FUNCTION fail_linked_intake() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'LINKED' THEN RAISE EXCEPTION 'intake update rejected'; END IF; RETURN NEW; END $$`)
    await pool.query(`CREATE TRIGGER fail_linked_intake BEFORE UPDATE ON patient_contact_intake FOR EACH ROW EXECUTE FUNCTION fail_linked_intake()`)
    try {
      const result = await createQuickPatient(doctor, { givenNames: 'Vínculo', surnames: 'Atómico', birthDate: '2024-06-01', sex: 'FEMALE', contacts: [{ name: 'Representante confirmado', relationship: 'Madre', phone, email: '', proof: 'Identidad verificada presencialmente', invite: false }] })
      const [grant] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, result.patient.id))
      const pending = await listPendingContacts(doctor, result.patient.id)
      expect(result.contacts[0]?.status).toBe('LINK_FAILED')
      expect(pending).toHaveLength(1)
      expect(grant).toBeUndefined()
    } finally {
      await pool.query('DROP TRIGGER fail_linked_intake ON patient_contact_intake')
      await pool.query('DROP FUNCTION fail_linked_intake()')
    }
  })

  it('clears an ineligible email, persists phone-only corrections even on failed retry, and never grants the wrong identity', async () => {
    const { retryPendingContact, listPendingContacts } = await import('../../server/services/patients')
    const childId = randomUUID()
    const intakeId = randomUUID()
    const email = `${randomUUID()}@example.test`
    const phone = `09${randomUUID().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`
    await db.insert(patient).values({ id: childId, name: 'Corrección sin correo', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
    const ineligible = randomUUID()
    await db.insert(user).values({ id: ineligible, name: 'No es representante', email })
    await db.insert(userRole).values({ userId: ineligible, role: 'ASSISTANT' })
    await db.insert(patientContactIntake).values({ id: intakeId, patientId: childId, position: 0, name: 'Familia real', phone, email, relationship: 'Madre', proof: 'Identidad comprobada en persona', invite: true, createdBy: doctor.id })
    await expect(retryPendingContact(doctor, childId, intakeId, { email: '', proof: 'Identidad nueva comprobada', confirmedGuardianId: ineligible })).rejects.toMatchObject({ statusCode: 409 })
    expect((await listPendingContacts(doctor, childId))[0]).toMatchObject({ email: null, status: 'LINK_FAILED' })
    expect(await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, childId))).toHaveLength(0)
    await expect(retryPendingContact(doctor, childId, intakeId, { confirmedGuardianId: ineligible })).rejects.toMatchObject({ statusCode: 409 })
    expect(await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, childId))).toHaveLength(0)
    const linked = await retryPendingContact(doctor, childId, intakeId, {})
    expect(linked.status).toBe('UNINVITED')
    const [owner] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, childId))
    expect(owner?.guardianId).not.toBe(ineligible)
    expect(owner?.contactPhone).toBe(phone)
    expect(owner?.status).toBe('UNINVITED')
    const [intake] = await db.select().from(patientContactIntake).where(eq(patientContactIntake.id, intakeId))
    expect(intake).toMatchObject({ email: null, invite: false, status: 'LINKED', guardianId: owner?.guardianId })
  })

  it('persists each contact when a second guardian link fails after patient insert and permits doctor-only verified recovery', async () => {
    const { createQuickPatient, listPendingContacts, retryPendingContact } = await import('../../server/services/patients')
    const phone = `09${randomUUID().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`
    const firstContact = { name: 'Primera persona', relationship: 'Madre', phone, email: '', proof: 'Identidad comprobada presencialmente', invite: false }
    const secondContact = { ...firstContact, name: 'Segunda persona', relationship: 'Padre' }
    const result = await createQuickPatient(doctor, { givenNames: 'Niña', surnames: 'Recuperación', birthDate: '2024-04-01', sex: 'FEMALE', contacts: [firstContact, secondContact] })
    expect(result.contacts.map(contact => contact.status)).toEqual(['UNINVITED', 'LINK_FAILED'])
    const pending = await listPendingContacts(doctor, result.patient.id)
    expect(pending).toEqual([expect.objectContaining({ name: secondContact.name, relationship: secondContact.relationship, phone, email: null, status: 'LINK_FAILED' })])
    await expect(listPendingContacts(assistant, result.patient.id)).rejects.toThrow()
    await expect(listPendingContacts({ id: otherId, roles: ['PATIENT'] }, result.patient.id)).rejects.toThrow()
    await expect(retryPendingContact(doctor, result.patient.id, pending[0]!.id, {})).rejects.toMatchObject({ statusCode: 409 })
    expect(await listPendingContacts(doctor, result.patient.id)).toHaveLength(1)
    const identity = await import('../../server/services/invitations').then(module => module.findGuardianIdentity(doctor, { phone }))
    const recovered = await retryPendingContact(doctor, result.patient.id, pending[0]!.id, { confirmedGuardianId: identity!.id })
    expect(recovered.status).toBe('UNINVITED')
    expect(await listPendingContacts(doctor, result.patient.id)).toEqual([])
    expect(await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, result.patient.id))).toHaveLength(1)
    await expect(retryPendingContact(doctor, result.patient.id, pending[0]!.id, { confirmedGuardianId: identity!.id })).rejects.toMatchObject({ statusCode: 404 })
    const wrongPhone = `09${randomUUID().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`
    const corrected = await createQuickPatient(doctor, { givenNames: 'Otro', surnames: 'Contacto Corregible', birthDate: '2024-05-01', sex: 'MALE', contacts: [
      { ...firstContact, phone: wrongPhone }, { ...secondContact, phone: wrongPhone }
    ] })
    const [failed] = await listPendingContacts(doctor, corrected.patient.id)
    await expect(retryPendingContact(doctor, corrected.patient.id, failed!.id, { phone, confirmedGuardianId: identity!.id })).rejects.toMatchObject({ statusCode: 400 })
    const recoveredCorrection = await retryPendingContact(doctor, corrected.patient.id, failed!.id, { phone, confirmedGuardianId: identity!.id, proof: 'Documento revisado nuevamente' })
    expect(recoveredCorrection.status).toBe('UNINVITED')
    expect(await listPendingContacts(doctor, corrected.patient.id)).toEqual([])
  })

  it('keeps a quick-created child after failed invitation, reuses one confirmed guardian for siblings, and sends later', async () => {
    const { createQuickPatient } = await import('../../server/services/patients')
    const { findGuardianIdentity, grantGuardian } = await import('../../server/services/invitations')
    const email = `${randomUUID()}@example.test`
    const phone = `09${randomUUID().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`
    const contact = { name: 'Familia Compartida', relationship: 'Madre', phone, email, proof: 'Documento comprobado presencialmente', invite: false }
    const created = await createQuickPatient(doctor, { givenNames: 'Luz', surnames: 'Santamaría', birthDate: '2024-02-01', sex: 'FEMALE', contacts: [contact] })
    expect(created.contacts[0]?.status).toBe('UNINVITED')
    const [firstGrant] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, created.patient.id))
    expect(firstGrant?.status).toBe('UNINVITED')
    const identity = await findGuardianIdentity(doctor, { email, phone })
    expect(identity?.id).toBe(firstGrant?.guardianId)
    const sibling = await createQuickPatient(doctor, { givenNames: 'Sol', surnames: 'Santamaría', birthDate: '2023-02-01', sex: 'MALE', contacts: [{ ...contact, confirmedGuardianId: identity!.id }] })
    const [secondGrant] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, sibling.patient.id))
    expect(secondGrant?.guardianId).toBe(firstGrant?.guardianId)
    expect(await db.select().from(user).where(eq(user.email, email))).toHaveLength(1)
    failDelivery = true
    try {
      expect((await grantGuardian(doctor, created.patient.id, { name: contact.name, phone, email, relationship: 'Madre', proof: contact.proof, confirmedGuardianId: identity!.id })).status).toBe('FAILED')
    } finally {
      failDelivery = false
    }
    expect((await db.select().from(patient).where(eq(patient.id, created.patient.id))).length).toBe(1)
    expect((await grantGuardian(doctor, created.patient.id, { name: contact.name, phone, email, relationship: 'Madre', proof: contact.proof, confirmedGuardianId: identity!.id })).status).toBe('PENDING')
    const [invited] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, created.patient.id))
    expect(invited?.contactEmail).toBe(email)
    expect((await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, sibling.patient.id)))[0]?.contactEmail).toBe(email)
    const noEmail = await createQuickPatient(doctor, { givenNames: 'Otra', surnames: 'Familia', birthDate: '2024-05-02', sex: 'MALE', contacts: [{ name: 'Sin correo', phone: `09${randomUUID().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`, relationship: 'Padre', proof: 'Identidad verificada presencialmente', email: '', invite: false }] })
    const [provisionalGrant] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, noEmail.patient.id))
    await grantGuardian(doctor, noEmail.patient.id, { name: 'Sin correo', phone: provisionalGrant!.contactPhone!, email: `${randomUUID()}@example.test`, relationship: 'Padre', proof: 'Identidad verificada presencialmente', confirmedGuardianId: provisionalGrant!.guardianId })
    const [updated] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, noEmail.patient.id))
    expect(updated?.contactEmail).not.toMatch(/portal\.invalid$/)
  })

  it('does not leave provisional and failed deliveries as the same status', async () => {
    const { createQuickPatient } = await import('../../server/services/patients')
    const phone = `09${randomUUID().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`
    const child = await createQuickPatient(doctor, { givenNames: 'Nina', surnames: 'Portal', birthDate: '2024-03-02', sex: 'FEMALE', contacts: [{ name: 'Familiar Portal', relationship: 'Madre', phone, email: '', invite: false, proof: 'Identidad vista presencialmente' }] })
    const [grant] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, child.patient.id))
    expect(child.contacts[0]?.status).toBe('UNINVITED')
    expect(grant?.status).toBe('UNINVITED')
    const { getShareableChild } = await import('../../server/services/invitations')
    await expect(getShareableChild({ id: grant!.guardianId, roles: ['PATIENT'] }, child.patient.id)).rejects.toThrow()
  })
  it('requires proof and staff authority, exposes only assistant-safe identity and invitation status', async () => {
    const { grantGuardian, listGrantCandidates } = await import('../../server/services/invitations')
    await expect(grantGuardian(adminActor, first, { name: 'Madre A', email: 'mother-a@example.test', proof: 'Documento verificado presencialmente' })).rejects.toThrow()
    await expect(grantGuardian(assistant, first, { name: 'Madre A', email: 'mother-a@example.test', proof: '' })).rejects.toThrow()
    await seedVisit(first)
    const candidates = await listGrantCandidates(assistant, 'Niña A')
    expect(candidates).toEqual([{ id: first, name: 'Niña A', guardians: [] }])
    expect(JSON.stringify(candidates)).not.toMatch(/PRIVATE|weightKg|birthDate|clinical/)
    const { getGrantCandidate } = await import('../../server/services/invitations')
    expect(await getGrantCandidate(assistant, first)).toEqual({ id: first, name: 'Niña A', guardians: [] })
    await expect(getGrantCandidate(adminActor, first)).rejects.toThrow()
    await grantGuardian(assistant, first, { name: 'Madre A', email: 'mother-a@example.test', proof: 'Documento verificado presencialmente' })
    const pending = await listGrantCandidates(assistant, 'Niña A')
    expect(pending[0]?.guardians).toEqual([{ email: 'mother-a@example.test', status: 'PENDING', lastSendError: null }])
    const [entry] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, first))
    expect(entry).toMatchObject({ verifiedBy: assistant.id, proof: 'Documento verificado presencialmente', status: 'PENDING' })
    expect(entry?.verifiedAt).toBeInstanceOf(Date)
    const [token] = await db.select().from(setupToken).where(eq(setupToken.userId, entry!.guardianId))
    expect(token?.expiresAt.getTime() - Date.now()).toBeGreaterThan(6 * 86400000)
    expect(token?.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(7 * 86400000)
    expect((await db.select().from(auditEvent).where(eq(auditEvent.subjectId, first))).some(row => row.action === 'GUARDIAN_GRANT' && row.outcome === 'ALLOWED')).toBe(true)
  })

  it('activates only the linked child on setup and denies guessed IDs and staff clinical reads', async () => {
    const { setupCredential } = await import('../../server/services/invitation')
    const { getShareableChild, listShareableChildren } = await import('../../server/services/invitations')
    await expect(getShareableChild({ id: guardianId, roles: ['PATIENT'] }, first)).rejects.toThrow()
    const token = latestToken()
    expect(await setupCredential(token, 'mother-unique', 'a sufficiently unique passphrase')).toBe(true)
    expect(await setupCredential(token, 'mother-another', 'another long unique phrase')).toBe(false)
    const [grant] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, first))
    expect(grant?.status).toBe('ACTIVE')
    const guardian: Actor = { id: grant!.guardianId, roles: ['PATIENT'] }
    expect((await listShareableChildren(guardian)).map(item => item.id)).toEqual([first])
    const own = await getShareableChild(guardian, first)
    expect(own.name).toBe('Niña A')
    expect(own.visits[0]?.parentAdvice).toBe('Conversar en consulta')
    expect(own.visits[0]).not.toHaveProperty('results')
    expect(JSON.stringify(own)).not.toMatch(/PRIVATE|authorId|calculatedBy|requestDigest|birthWeightKg/)
    await expect(getShareableChild(guardian, second)).rejects.toThrow()
    await expect(getShareableChild({ id: otherId, roles: ['PATIENT'] }, first)).rejects.toThrow()
    await expect(getShareableChild(assistant, first)).rejects.toThrow()
    await expect(getShareableChild(adminActor, first)).rejects.toThrow()
    expect((await db.select().from(auditEvent).where(and(eq(auditEvent.actorId, otherId), eq(auditEvent.action, 'PORTAL_READ')))).some(row => row.outcome === 'DENIED')).toBe(true)
  })

  it('leaves failed delivery pending, retries independently and revokes a relationship immediately', async () => {
    const { grantGuardian, revokeGuardian, getShareableChild } = await import('../../server/services/invitations')
    failDelivery = true
    try {
      await grantGuardian(doctor, second, { name: 'Madre B', email: 'mother-b@example.test', proof: 'Documento verificado' })
    } finally {
      failDelivery = false
    }
    const [failed] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, second))
    expect(failed?.status).toBe('FAILED')
    expect(failed?.lastSendError).toBe('Error')
    expect((await db.select().from(auditEvent).where(eq(auditEvent.subjectId, second))).some(row => row.action === 'GUARDIAN_DELIVERY_FAILED')).toBe(true)
    await grantGuardian(doctor, second, { name: 'Madre B', email: 'mother-b@example.test', proof: 'Documento verificado', confirmedGuardianId: failed!.guardianId })
    const token = latestToken()
    const { setupCredential } = await import('../../server/services/invitation')
    expect(await setupCredential(token, 'mother-b-unique', 'a sufficiently unique passphrase')).toBe(true)
    const guardian: Actor = { id: failed!.guardianId, roles: ['PATIENT'] }
    expect((await getShareableChild(guardian, second)).id).toBe(second)
    await revokeGuardian(doctor, second, failed!.guardianId)
    await expect(getShareableChild(guardian, second)).rejects.toThrow()
    expect((await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, second)))[0]?.status).toBe('REVOKED')
  })

  it('persists doctor sharing defaults and a known next-control time while rejecting inverted dates', async () => {
    const { createVisit } = await import('../../server/services/visits')
    const { visitSchema } = await import('../../shared/types/measurement')
    const input = { requestId: randomUUID(), measuredAt: '2025-01-01T12:00:00.000Z', weightKg: 9, lengthHeightCm: 75, position: 'RECUMBENT' as const, headCircumferenceCm: 45, shareWithFamily: false, nextControlAt: '2025-02-01T14:30:00.000Z', parentAdvice: 'Volver en febrero', privateNote: 'ONLY_DOCTOR' }
    expect(() => visitSchema.parse({ ...input, nextControlAt: '2024-12-01T12:00:00.000Z' })).toThrow()
    const stored = await createVisit(doctor, first, input)
    expect(stored.shareWithFamily).toBe(false)
    expect(stored.nextControlAt).toBe('2025-02-01T14:30:00.000Z')
    const [link] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, first))
    const guardian: Actor = { id: link!.guardianId, roles: ['PATIENT'] }
    const { getShareableChild, setVisitSharing } = await import('../../server/services/invitations')
    expect((await getShareableChild(guardian, first)).visits.some(item => item.parentAdvice === 'Volver en febrero')).toBe(false)
    await setVisitSharing(doctor, first, stored.id, true)
    expect((await getShareableChild(guardian, first)).visits.find(item => item.parentAdvice === 'Volver en febrero')?.nextControlAt).toBe('2025-02-01T14:30:00.000Z')
  })

  it('lets only a doctor change visit sharing without mutating the clinical snapshot', async () => {
    const { setVisitSharing, getShareableChild } = await import('../../server/services/invitations')
    const [link] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, first))
    const guardian: Actor = { id: link!.guardianId, roles: ['PATIENT'] }
    const [original] = await db.select({ id: visit.id }).from(visit).leftJoin(visitText, eq(visitText.visitId, visit.id)).where(and(eq(visit.patientId, first), eq(visitText.parentAdvice, 'Volver en febrero')))
    await expect(setVisitSharing(assistant, first, original!.id, false)).rejects.toThrow()
    await expect(setVisitSharing({ id: otherId, roles: ['PATIENT'] }, first, original!.id, false)).rejects.toThrow()
    await setVisitSharing(doctor, first, original!.id, false)
    expect((await getShareableChild(guardian, first)).visits.some(item => item.parentAdvice === 'Volver en febrero')).toBe(false)
    await setVisitSharing(doctor, first, original!.id, true)
    expect((await getShareableChild(guardian, first)).visits.some(item => item.parentAdvice === 'Volver en febrero')).toBe(true)
  })

  it('only projects doctor-shared visits and never sends growth interpretations to families', async () => {
    const { getShareableChild, listShareableChildren } = await import('../../server/services/invitations')
    const [link] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, first))
    const guardian: Actor = { id: link!.guardianId, roles: ['PATIENT'] }
    await seedVisit(first, false)
    const own = await getShareableChild(guardian, first)
    expect(own.visits.some(item => item.parentAdvice === 'Volver en febrero')).toBe(true)
    expect(JSON.stringify(own)).not.toMatch(/results|percentile|"z"|bmi|PRIVATE_SECRET/)
    const cards = await listShareableChildren(guardian)
    expect(cards.find(child => child.id === first)?.lastControl?.parentAdvice).toBe('Volver en febrero')
    expect(JSON.stringify(cards)).not.toMatch(/results|percentile|"z"|bmi|PRIVATE_SECRET/)
  })

  it('does not publish unverified available snapshots or unsupported ages', async () => {
    const { getShareableChild } = await import('../../server/services/invitations')
    const [link] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, first))
    const guardian: Actor = { id: link!.guardianId, roles: ['PATIENT'] }
    const [initial] = await db.select({ id: visit.id }).from(visit).where(eq(visit.patientId, first))
    await db.insert(visitResult).values({ id: randomUUID(), visitId: initial!.id, indicator: 'HEIGHT_FOR_AGE', snapshot: { status: 'available', z: -2.41, percentile: 0.8 }, calculatedBy: doctor.id })
    expect(JSON.stringify(await getShareableChild(guardian, first))).not.toMatch(/HEIGHT_FOR_AGE|percentile|"z"/)
    const old = randomUUID()
    await db.insert(patient).values({ id: old, name: 'Mayor', birthDate: '2018-01-01', sex: 'MALE', createdBy: doctor.id })
    await db.insert(guardianGrant).values({ patientId: old, guardianId: guardian.id, contactEmail: 'mother-a@example.test', proof: 'Documento verificado', verifiedBy: doctor.id, status: 'ACTIVE' })
    const visitId = await seedVisit(old)
    await db.insert(visitResult).values({ id: randomUUID(), visitId, indicator: 'WEIGHT_FOR_AGE', snapshot: { status: 'available', z: 1.3, percentile: 90, reference: { standard: 'WHO_2006' } }, calculatedBy: doctor.id })
    expect(JSON.stringify(await getShareableChild(guardian, old))).not.toMatch(/WEIGHT_FOR_AGE|percentile|"z"/)
  })

  it('does not silently activate an existing account after rejected delivery', async () => {
    const { grantGuardian, getShareableChild } = await import('../../server/services/invitations')
    const [owner] = await db.select().from(user).where(eq(user.email, 'mother-a@example.test'))
    const childId = randomUUID()
    await db.insert(patient).values({ id: childId, name: 'Fallo entrega', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
    failDelivery = true
    try {
      expect((await grantGuardian(doctor, childId, { name: 'Madre A', email: 'mother-a@example.test', proof: 'Documento verificado', confirmedGuardianId: owner!.id })).status).toBe('FAILED')
    } finally {
      failDelivery = false
    }
    await expect(getShareableChild({ id: owner!.id, roles: ['PATIENT'] }, childId)).rejects.toThrow()
  })

  it('bounds pending invitations to the intended relationship and never grants a different child on setup', async () => {
    const { grantGuardian, getShareableChild, revokeGuardian } = await import('../../server/services/invitations')
    const { setupCredential } = await import('../../server/services/invitation')
    const unlinked = randomUUID()
    await db.insert(patient).values({ id: unlinked, name: 'No vinculado', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
    const email = `${randomUUID()}@example.test`
    await grantGuardian(assistant, unlinked, { name: 'Representante', email, proof: 'Verificación presencial' })
    const token = latestToken()
    const [link] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, unlinked))
    await revokeGuardian(assistant, unlinked, link!.guardianId)
    expect(await setupCredential(token, `revoked-${randomUUID().slice(0, 8)}`, 'a sufficiently unique passphrase')).toBe(false)
    await expect(getShareableChild({ id: link!.guardianId, roles: ['PATIENT'] }, unlinked)).rejects.toThrow()
  })

  it('keeps the last shared control in the home summary when a newer visit is private', async () => {
    const { listShareableChildren } = await import('../../server/services/invitations')
    const [link] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, first))
    const guardian: Actor = { id: link!.guardianId, roles: ['PATIENT'] }
    const secretId = randomUUID()
    await db.insert(visit).values({ id: secretId, patientId: first, requestId: randomUUID(), requestDigest: 'later', measuredAt: new Date('2026-01-01T12:00:00Z'), weightKg: '11', lengthHeightCm: '80', position: 'STANDING', headCircumferenceCm: '47', bmi: '17', correctionUntilMonths: 24, authorId: doctor.id, shareWithFamily: false })
    await db.insert(visitText).values({ visitId: secretId, privateNote: 'PRIVATE_NEW', parentAdvice: 'NOT_SHARED' })
    const home = await listShareableChildren(guardian)
    expect(home.find(child => child.id === first)?.lastControl?.weightKg).toBe(9)
    expect(JSON.stringify(home)).not.toMatch(/NOT_SHARED|PRIVATE_NEW|"weightKg":11/)
  })

  it('keeps an active sibling link active when a reminder email fails', async () => {
    const { grantGuardian, getShareableChild } = await import('../../server/services/invitations')
    const [owner] = await db.select().from(user).where(eq(user.email, 'mother-a@example.test'))
    const childId = randomUUID()
    await db.insert(patient).values({ id: childId, name: 'Hermano con acceso', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
    await grantGuardian(doctor, childId, { name: 'Madre A', email: 'mother-a@example.test', proof: 'Identidad verificada', confirmedGuardianId: owner!.id })
    failDelivery = true
    try {
      await grantGuardian(doctor, childId, { name: 'Madre A', email: 'mother-a@example.test', proof: 'Identidad verificada', confirmedGuardianId: owner!.id })
    } finally {
      failDelivery = false
    }
    const [retained] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, childId))
    expect(retained?.status).toBe('ACTIVE')
    expect(retained?.lastSendError).toBe('Error')
    expect((await getShareableChild({ id: owner!.id, roles: ['PATIENT'] }, childId)).id).toBe(childId)
  })

  it('requires staff to confirm an existing identity before linking and can resend a pending link', async () => {
    const { grantGuardian, findGuardianIdentity } = await import('../../server/services/invitations')
    const email = 'mother-b@example.test'
    const [existing] = await db.select().from(user).where(eq(user.email, email))
    const match = await findGuardianIdentity(assistant, email)
    expect(match).toMatchObject({ name: 'Madre B', maskedContact: 'm***@e***' })
    expect(JSON.stringify(match)).not.toContain(email)
    await expect(findGuardianIdentity(adminActor, email)).rejects.toThrow()
    const sibling = randomUUID()
    await db.insert(patient).values({ id: sibling, name: 'Hermana B', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
    await expect(grantGuardian(assistant, sibling, { name: 'Madre B', email, proof: 'Identidad verificada' })).rejects.toThrow()
    expect((await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, sibling)))).toHaveLength(0)
    await expect(grantGuardian(assistant, sibling, { name: 'Madre B', email: `${randomUUID()}@example.test`, proof: 'Identidad verificada', confirmedGuardianId: existing!.id })).rejects.toThrow()
    const result = await grantGuardian(assistant, sibling, { name: 'Madre B', email, proof: 'Identidad verificada', confirmedGuardianId: existing!.id })
    expect(result.status).toBe('ACTIVE')
    const fresh = randomUUID()
    await db.insert(patient).values({ id: fresh, name: 'Hermano nuevo', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
    const newEmail = `${randomUUID()}@example.test`
    await grantGuardian(doctor, fresh, { name: 'Nuevo padre', email: newEmail, proof: 'Identidad verificada' })
    const previousToken = latestToken()
    const [newOwner] = await db.select({ id: user.id }).from(user).where(eq(user.email, newEmail))
    await grantGuardian(doctor, fresh, { name: 'Nuevo padre', email: newEmail, proof: 'Identidad verificada', confirmedGuardianId: newOwner!.id })
    const [oldToken] = await db.select().from(setupToken).where(eq(setupToken.digest, (await import('../../server/services/invitation')).tokenDigest(previousToken)))
    expect(oldToken?.usedAt).toBeInstanceOf(Date)
    const [currentLink] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, fresh))
    expect(currentLink?.tokenId).not.toBe(oldToken?.id)
    expect(currentLink?.status).toBe('PENDING')
    const { setupCredential } = await import('../../server/services/invitation')
    expect(await setupCredential(previousToken, 'old-guardian', 'unique passphrase for guardian')).toBe(false)
  })

  it('does not send a stale queued invite after a newer resend was delivered', async () => {
    const { grantGuardian, processGuardianDelivery } = await import('../../server/services/invitations')
    const { setupCredential, tokenDigest } = await import('../../server/services/invitation')
    const childId = randomUUID()
    const email = `${randomUUID()}@example.test`
    await db.insert(patient).values({ id: childId, name: 'Reordenado', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
    await pool.query(`CREATE FUNCTION reject_first_claim() RETURNS trigger AS $$ BEGIN IF NEW.patient_id = '${childId}' AND NEW.state = 'SENDING' THEN RAISE EXCEPTION 'forced old claim failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`)
    await pool.query('CREATE TRIGGER forced_first_claim BEFORE UPDATE ON guardian_delivery FOR EACH ROW EXECUTE FUNCTION reject_first_claim()')
    try {
      await expect(grantGuardian(doctor, childId, { name: 'Familiar ordenado', email, proof: 'Identidad verificada' })).rejects.toThrow()
    } finally {
      await pool.query('DROP TRIGGER forced_first_claim ON guardian_delivery')
      await pool.query('DROP FUNCTION reject_first_claim()')
    }
    const [old] = await db.select().from(guardianDelivery).where(eq(guardianDelivery.patientId, childId))
    expect(old?.state).toBe('QUEUED')
    const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
    await grantGuardian(doctor, childId, { name: 'Familiar ordenado', email, proof: 'Identidad verificada', confirmedGuardianId: owner!.id })
    const newest = latestToken()
    const sent = mails.length
    const [newToken] = await db.select().from(setupToken).where(eq(setupToken.digest, tokenDigest(newest)))
    expect((await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, childId)))[0]?.tokenId).toBe(newToken!.id)
    await processGuardianDelivery(old!.id)
    expect((await db.select().from(guardianDelivery).where(eq(guardianDelivery.id, old!.id)))[0]?.state).toBe('CANCELLED')
    expect((await db.select().from(setupToken).where(eq(setupToken.id, old!.tokenId!)))[0]?.usedAt).toBeInstanceOf(Date)
    expect((await db.select().from(guardianDelivery).where(and(eq(guardianDelivery.patientId, childId), eq(guardianDelivery.state, 'QUEUED'))))).toHaveLength(0)
    expect(mails).toHaveLength(sent)
    expect((await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, childId)))[0]?.tokenId).toBe(newToken!.id)
    expect((await db.select().from(setupToken).where(eq(setupToken.id, newToken!.id)))[0]?.usedAt).toBeNull()
    expect(await setupCredential(newest, `ordered-${randomUUID().slice(0, 8)}`, 'unique guardian passphrase')).toBe(true)
  })

  it('ignores an older sending job if a newer resend finishes while its SMTP call is in flight', async () => {
    const { grantGuardian, processGuardianDelivery } = await import('../../server/services/invitations')
    const { setupCredential, tokenDigest } = await import('../../server/services/invitation')
    const childId = randomUUID()
    const email = `${randomUUID()}@example.test`
    await db.insert(patient).values({ id: childId, name: 'Entrega tardía', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
    await pool.query(`CREATE FUNCTION reject_first_claim() RETURNS trigger AS $$ BEGIN IF NEW.patient_id = '${childId}' AND NEW.state = 'SENDING' THEN RAISE EXCEPTION 'forced old claim failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`)
    await pool.query('CREATE TRIGGER forced_first_claim BEFORE UPDATE ON guardian_delivery FOR EACH ROW EXECUTE FUNCTION reject_first_claim()')
    try {
      await expect(grantGuardian(doctor, childId, { name: 'Familiar tardío', email, proof: 'Identidad verificada' })).rejects.toThrow()
    } finally {
      await pool.query('DROP TRIGGER forced_first_claim ON guardian_delivery')
      await pool.query('DROP FUNCTION reject_first_claim()')
    }
    const [old] = await db.select().from(guardianDelivery).where(eq(guardianDelivery.patientId, childId))
    const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
    await db.update(guardianDelivery).set({ state: 'SENDING' }).where(eq(guardianDelivery.id, old!.id))
    await grantGuardian(doctor, childId, { name: 'Familiar tardío', email, proof: 'Identidad verificada', confirmedGuardianId: owner!.id })
    const newest = latestToken()
    const [newToken] = await db.select().from(setupToken).where(eq(setupToken.digest, tokenDigest(newest)))
    const sent = mails.length
    await processGuardianDelivery(old!.id)
    expect(mails).toHaveLength(sent)
    expect((await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, childId)))[0]?.tokenId).toBe(newToken!.id)
    expect(await setupCredential(newest, `late-${randomUUID().slice(0, 8)}`, 'unique guardian passphrase')).toBe(true)
    await db.update(guardianDelivery).set({ state: 'CANCELLED', payload: null }).where(eq(guardianDelivery.id, old!.id))
  })

  it('activates two delivered sibling grants with one setup and excludes revoked or undelivered links', async () => {
    const { grantGuardian, revokeGuardian, getShareableChild, listShareableChildren } = await import('../../server/services/invitations')
    const { setupCredential } = await import('../../server/services/invitation')
    const email = `${randomUUID()}@example.test`
    const children = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
    await db.insert(patient).values(children.map((id, i) => ({ id, name: `Hermano ${i}`, birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })))
    await grantGuardian(doctor, children[0]!, { name: 'Familia compartida', email, proof: 'Identidad presencial' })
    const firstToken = latestToken()
    const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
    await grantGuardian(assistant, children[1]!, { name: 'Familia compartida', email, proof: 'Identidad presencial', confirmedGuardianId: owner!.id })
    const secondToken = latestToken()
    await grantGuardian(assistant, children[2]!, { name: 'Familia compartida', email, proof: 'Identidad presencial', confirmedGuardianId: owner!.id })
    await revokeGuardian(assistant, children[2]!, owner!.id)
    failDelivery = true
    try {
      await grantGuardian(doctor, children[3]!, { name: 'Familia compartida', email, proof: 'Identidad presencial', confirmedGuardianId: owner!.id })
    } finally {
      failDelivery = false
    }
    expect(await setupCredential(secondToken, `sibling-${randomUUID().slice(0, 8)}`, 'unique guardian passphrase')).toBe(true)
    expect(await setupCredential(firstToken, `stale-${randomUUID().slice(0, 8)}`, 'another unique guardian passphrase')).toBe(false)
    const linked = await listShareableChildren({ id: owner!.id, roles: ['PATIENT'] })
    expect(linked.map(child => child.id).sort()).toEqual(children.slice(0, 2).sort())
    await expect(getShareableChild({ id: owner!.id, roles: ['PATIENT'] }, children[2]!)).rejects.toThrow()
    await expect(getShareableChild({ id: owner!.id, roles: ['PATIENT'] }, children[3]!)).rejects.toThrow()
  })

  it('does not email a link if persisting the grant fails', async () => {
    const { grantGuardian } = await import('../../server/services/invitations')
    const childId = randomUUID()
    const email = `${randomUUID()}@example.test`
    await db.insert(patient).values({ id: childId, name: 'Persistencia fallida', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
    const sent = mails.length
    await pool.query(`CREATE FUNCTION reject_guardian_insert() RETURNS trigger AS $$ BEGIN IF NEW.patient_id = '${childId}' THEN RAISE EXCEPTION 'forced grant failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`)
    await pool.query('CREATE TRIGGER forced_guardian_insert BEFORE INSERT ON guardian_grant FOR EACH ROW EXECUTE FUNCTION reject_guardian_insert()')
    try {
      await expect(grantGuardian(doctor, childId, { name: 'Familia fallida', email, proof: 'Identidad presencial' })).rejects.toThrow()
      expect(mails).toHaveLength(sent)
      expect(await db.select().from(user).where(eq(user.email, email))).toHaveLength(0)
    } finally {
      await pool.query('DROP TRIGGER forced_guardian_insert ON guardian_grant')
      await pool.query('DROP FUNCTION reject_guardian_insert()')
    }
  })

  it('keeps a previously delivered link valid if replacement SMTP rejects and records failure', async () => {
    const { grantGuardian } = await import('../../server/services/invitations')
    const { setupCredential, tokenDigest } = await import('../../server/services/invitation')
    const childId = randomUUID()
    const email = `${randomUUID()}@example.test`
    await db.insert(patient).values({ id: childId, name: 'Reenvío fallido', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
    await grantGuardian(doctor, childId, { name: 'Familia reenvío', email, proof: 'Identidad presencial' })
    const original = latestToken()
    const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
    failDelivery = true
    try {
      await grantGuardian(doctor, childId, { name: 'Familia reenvío', email, proof: 'Identidad presencial', confirmedGuardianId: owner!.id })
    } finally {
      failDelivery = false
    }
    const [link] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, childId))
    const [oldToken] = await db.select().from(setupToken).where(eq(setupToken.digest, tokenDigest(original)))
    expect(link).toMatchObject({ status: 'PENDING', tokenId: oldToken!.id, lastSendError: 'Error' })
    expect(oldToken?.usedAt).toBeNull()
    const [attempt] = await db.select().from(guardianDelivery).where(and(eq(guardianDelivery.patientId, childId), eq(guardianDelivery.state, 'FAILED')))
    expect(attempt?.payload).toBeNull()
    expect(await setupCredential(original, `retry-${randomUUID().slice(0, 8)}`, 'unique guardian passphrase')).toBe(true)
  })

  it('sends a committed queued invitation after a forced post-commit dispatch failure', async () => {
    const { grantGuardian, processGuardianDelivery } = await import('../../server/services/invitations')
    const childId = randomUUID()
    const email = `${randomUUID()}@example.test`
    await db.insert(patient).values({ id: childId, name: 'Pendiente de reintento', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
    const sent = mails.length
    await pool.query(`CREATE FUNCTION reject_guardian_claim() RETURNS trigger AS $$ BEGIN IF NEW.patient_id = '${childId}' AND NEW.state = 'SENDING' THEN RAISE EXCEPTION 'forced claim failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`)
    await pool.query('CREATE TRIGGER forced_guardian_claim BEFORE UPDATE ON guardian_delivery FOR EACH ROW EXECUTE FUNCTION reject_guardian_claim()')
    try {
      await expect(grantGuardian(doctor, childId, { name: 'Familia pendiente', email, proof: 'Identidad presencial' })).rejects.toThrow()
      expect(mails).toHaveLength(sent)
      const [saved] = await db.select().from(guardianDelivery).where(eq(guardianDelivery.patientId, childId))
      expect(saved?.state).toBe('QUEUED')
      expect(saved?.payload).toBeTruthy()
    } finally {
      await pool.query('DROP TRIGGER forced_guardian_claim ON guardian_delivery')
      await pool.query('DROP FUNCTION reject_guardian_claim()')
    }
    const [job] = await db.select().from(guardianDelivery).where(eq(guardianDelivery.patientId, childId))
    await processGuardianDelivery(job!.id)
    expect(mails).toHaveLength(sent + 1)
    const [link] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, childId))
    expect(link?.status).toBe('PENDING')
    const { setupCredential } = await import('../../server/services/invitation')
    const token = latestToken()
    expect(await setupCredential(token, `recover-${randomUUID().slice(0, 8)}`, 'unique guardian passphrase')).toBe(true)
  })

  it('activates a delivered queued sibling after the guardian sets up the account from another child', async () => {
    const { grantGuardian, processGuardianDelivery, getShareableChild } = await import('../../server/services/invitations')
    const { setupCredential } = await import('../../server/services/invitation')
    const email = `${randomUUID()}@example.test`
    const children = [randomUUID(), randomUUID()]
    await db.insert(patient).values(children.map(id => ({ id, name: 'Hijo en cola', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })))
    await grantGuardian(doctor, children[0]!, { name: 'Familia en cola', email, proof: 'Identidad presencial' })
    const firstToken = latestToken()
    const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
    await pool.query(`CREATE FUNCTION reject_queued_sibling() RETURNS trigger AS $$ BEGIN IF NEW.patient_id = '${children[1]}' AND NEW.state = 'SENDING' THEN RAISE EXCEPTION 'forced claim failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`)
    await pool.query('CREATE TRIGGER forced_sibling_claim BEFORE UPDATE ON guardian_delivery FOR EACH ROW EXECUTE FUNCTION reject_queued_sibling()')
    try {
      await expect(grantGuardian(doctor, children[1]!, { name: 'Familia en cola', email, proof: 'Identidad presencial', confirmedGuardianId: owner!.id })).rejects.toThrow()
    } finally {
      await pool.query('DROP TRIGGER forced_sibling_claim ON guardian_delivery')
      await pool.query('DROP FUNCTION reject_queued_sibling()')
    }
    expect(await setupCredential(firstToken, `queued-${randomUUID().slice(0, 8)}`, 'unique guardian passphrase')).toBe(true)
    const [siblingJob] = await db.select().from(guardianDelivery).where(eq(guardianDelivery.patientId, children[1]!))
    await processGuardianDelivery(siblingJob!.id)
    expect((await db.select().from(guardianDelivery).where(eq(guardianDelivery.id, siblingJob!.id)))[0]?.state).toBe('DONE')
    const [siblingLink] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, children[1]!))
    expect(siblingLink?.status).toBe('ACTIVE')
    expect((await getShareableChild({ id: owner!.id, roles: ['PATIENT'] }, children[1]!)).id).toBe(children[1])
  })

  it('never dispatches a queued link after the staff revokes its relationship', async () => {
    const { grantGuardian, processGuardianDelivery, revokeGuardian } = await import('../../server/services/invitations')
    const childId = randomUUID()
    const email = `${randomUUID()}@example.test`
    await db.insert(patient).values({ id: childId, name: 'Vínculo revocado', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
    await pool.query(`CREATE FUNCTION reject_guardian_claim() RETURNS trigger AS $$ BEGIN IF NEW.patient_id = '${childId}' AND NEW.state = 'SENDING' THEN RAISE EXCEPTION 'forced claim failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`)
    await pool.query('CREATE TRIGGER forced_guardian_claim BEFORE UPDATE ON guardian_delivery FOR EACH ROW EXECUTE FUNCTION reject_guardian_claim()')
    try {
      await expect(grantGuardian(doctor, childId, { name: 'Familia revocada', email, proof: 'Identidad presencial' })).rejects.toThrow()
    } finally {
      await pool.query('DROP TRIGGER forced_guardian_claim ON guardian_delivery')
      await pool.query('DROP FUNCTION reject_guardian_claim()')
    }
    const [link] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, childId))
    await revokeGuardian(doctor, childId, link!.guardianId)
    const sent = mails.length
    const [job] = await db.select().from(guardianDelivery).where(eq(guardianDelivery.patientId, childId))
    await processGuardianDelivery(job!.id)
    expect(mails).toHaveLength(sent)
  })

  it('recovers an interrupted delivery with its committed token and no orphaned link', async () => {
    const { grantGuardian, processGuardianDelivery, reconcileGuardianDeliveries } = await import('../../server/services/invitations')
    const childId = randomUUID()
    const email = `${randomUUID()}@example.test`
    await db.insert(patient).values({ id: childId, name: 'Entrega interrumpida', birthDate: '2024-01-01', sex: 'FEMALE', createdBy: doctor.id })
    const sent = mails.length
    await pool.query(`CREATE FUNCTION reject_guardian_finish() RETURNS trigger AS $$ BEGIN IF NEW.patient_id = '${childId}' AND NEW.state = 'DONE' THEN RAISE EXCEPTION 'forced finish failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`)
    await pool.query('CREATE TRIGGER forced_guardian_finish BEFORE UPDATE ON guardian_delivery FOR EACH ROW EXECUTE FUNCTION reject_guardian_finish()')
    try {
      await expect(grantGuardian(doctor, childId, { name: 'Familiar en espera', email, proof: 'Identidad presencial' })).rejects.toThrow()
      expect(mails).toHaveLength(sent + 1)
      const [saved] = await db.select().from(guardianDelivery).where(eq(guardianDelivery.patientId, childId))
      expect(saved).toMatchObject({ state: 'SENDING' })
      expect(saved?.payload).toBeTruthy()
    } finally {
      await pool.query('DROP TRIGGER forced_guardian_finish ON guardian_delivery')
      await pool.query('DROP FUNCTION reject_guardian_finish()')
    }
    expect(await reconcileGuardianDeliveries()).toBe(1)
    const [queuedJob] = await db.select().from(guardianDelivery).where(eq(guardianDelivery.patientId, childId))
    await processGuardianDelivery(queuedJob!.id)
    const [link] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, childId))
    expect(link?.status).toBe('PENDING')
    const [stored] = await db.select().from(setupToken).where(eq(setupToken.id, link!.tokenId!))
    expect(stored?.usedAt).toBeNull()
    expect(mails.at(-1)).toContain('invitacion/')
  })

  it('matches a phone-only representative by normalized number only after explicit attestation, without creating email duplicates', async () => {
    const { grantGuardian, findGuardianIdentity, getShareableChild } = await import('../../server/services/invitations')
    const one = randomUUID()
    const two = randomUUID()
    await db.insert(patient).values([one, two].map(id => ({ id, name: 'Hermano por teléfono', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })))
    const phone = `09${randomUUID().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`
    const firstResult = await grantGuardian(assistant, one, { name: 'Padre teléfono', phone, relationship: 'Padre', proof: 'Identidad presencial verificada' })
    expect(firstResult.status).toBe('UNINVITED')
    expect(await db.select().from(guardianDelivery).where(eq(guardianDelivery.patientId, one))).toHaveLength(0)
    const [phoneLink] = await db.select().from(guardianGrant).where(eq(guardianGrant.patientId, one))
    expect(phoneLink).toMatchObject({ contactPhone: phone, relationship: 'Padre', status: 'UNINVITED', proof: 'Identidad presencial verificada' })
    expect(await db.select().from(user).where(eq(user.id, phoneLink!.guardianId))).toHaveLength(1)
    const match = await findGuardianIdentity(assistant, { phone: `+593${phone.slice(1)}` })
    expect(match).toMatchObject({ name: 'Padre teléfono' })
    expect(JSON.stringify(match)).not.toContain(phone)
    expect(match?.maskedContact).toBe(`${phone.slice(0, 2)}***${phone.slice(-2)}`)
    await expect(findGuardianIdentity(assistant, { phone: '123' })).rejects.toThrow()
    await expect(findGuardianIdentity(adminActor, { phone })).rejects.toThrow()
    await expect(grantGuardian(assistant, two, { name: 'Padre teléfono', phone, relationship: 'Padre', proof: 'Identidad presencial verificada' })).rejects.toThrow()
    const linked = await grantGuardian(doctor, two, { name: 'Padre teléfono', phone: `+593${phone.slice(1)}`, relationship: 'Padre', proof: 'Identidad presencial verificada', confirmedGuardianId: match!.id })
    expect(linked.status).toBe('UNINVITED')
    expect((await db.select().from(guardianGrant).where(eq(guardianGrant.guardianId, match!.id)))).toHaveLength(2)
    await expect(getShareableChild({ id: match!.id, roles: ['PATIENT'] }, one)).rejects.toThrow()
    const email = `${randomUUID()}@example.test`
    await grantGuardian(doctor, one, { name: 'Padre teléfono', phone, email, relationship: 'Padre', proof: 'Correo verificado presencialmente', confirmedGuardianId: match!.id })
    expect(await db.select().from(user).where(eq(user.email, email))).toHaveLength(1)
    await expect(grantGuardian(doctor, two, { name: 'Otro padre', phone, email: `${randomUUID()}@example.test`, relationship: 'Padre', proof: 'Identidad presencial', confirmedGuardianId: match!.id })).rejects.toThrow()
    const stranger = randomUUID()
    await db.insert(user).values({ id: stranger, name: 'Otro contacto', email: `${randomUUID()}@example.test` })
    await db.insert(guardianPhone).values({ guardianId: stranger, phone: '0999999999' })
    await expect(grantGuardian(doctor, two, { name: 'Contacto cruzado', phone: '0999999999', email, relationship: 'Padre', proof: 'Identidad presencial', confirmedGuardianId: match!.id })).rejects.toThrow()
  })

  it('grants an existing guardian without resetting credentials or granting any other child', async () => {
    const { grantGuardian, getShareableChild } = await import('../../server/services/invitations')
    const third = randomUUID()
    await db.insert(patient).values({ id: third, name: 'Niño C', birthDate: '2024-01-01', sex: 'MALE', createdBy: doctor.id })
    const [owner] = await db.select().from(user).where(eq(user.email, 'mother-a@example.test'))
    const [credential] = await db.select().from(account).where(eq(account.userId, owner!.id))
    await grantGuardian(doctor, third, { name: 'Madre A', email: 'mother-a@example.test', proof: 'Documento verificado', confirmedGuardianId: owner!.id })
    const [unchanged] = await db.select().from(account).where(eq(account.userId, owner!.id))
    expect(unchanged?.password).toBe(credential?.password)
    expect((await getShareableChild({ id: owner!.id, roles: ['PATIENT'] }, third)).id).toBe(third)
    await expect(getShareableChild({ id: otherId, roles: ['PATIENT'] }, third)).rejects.toThrow()
  })
})
