import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { eq, sql } from 'drizzle-orm'
import { Pool } from 'pg'
import type { Actor } from '../../shared/types/access'
import { auditEvent, smtpSettings } from '../../server/db/schema'
import { decryptSmtpSecret, getSmtpSettings, resolveSmtpTransport, saveSmtpSettings } from '../../server/services/smtp-settings'

const source = process.env.DATABASE_URL
if (!source || !new URL(source).pathname.includes('pediatrico')) throw new Error('Dedicated pediatric test server required')
const name = `pediatrico_smtp_${randomUUID().replaceAll('-', '')}`
const adminUrl = new URL(source)
adminUrl.pathname = '/postgres'
const target = new URL(source)
target.pathname = `/${name}`
const adminPool = new Pool({ connectionString: adminUrl.href })
const pool = new Pool({ connectionString: target.href })
const db = drizzle(pool)
const previousUrl = process.env.DATABASE_URL
const previousKey = process.env.SMTP_CONFIG_KEY
const envNames = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'] as const
const previousEnv = Object.fromEntries(envNames.map(key => [key, process.env[key]]))
const admin: Actor = { id: randomUUID(), roles: ['ADMIN'] }
const doctor: Actor = { id: randomUUID(), roles: ['DOCTOR'] }
const input = { host: 'smtp.example.test', port: 587, security: 'STARTTLS' as const, username: 'mailer', password: 'secret-one', fromName: 'Clínica', fromAddress: 'clinic@example.test' }
let created = false

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${name}"`)
  created = true
  process.env.DATABASE_URL = target.href
  await migrate(db, { migrationsFolder: './server/db/migrations' })
}, 120000)

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE smtp_settings, audit_event RESTART IDENTITY CASCADE`)
  process.env.SMTP_CONFIG_KEY = 'a1'.repeat(32)
  for (const key of envNames) Reflect.deleteProperty(process.env, key)
})

afterAll(async () => {
  process.env.DATABASE_URL = previousUrl
  if (previousKey === undefined) delete process.env.SMTP_CONFIG_KEY
  else process.env.SMTP_CONFIG_KEY = previousKey
  for (const key of envNames) {
    const value = previousEnv[key]
    if (value === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = value
  }
  await pool.end()
  const { useDb } = await import('../../server/utils/db')
  await useDb().$client.end()
  try {
    if (created) await adminPool.query(`DROP DATABASE "${name}"`)
  } finally {
    await adminPool.end()
  }
})

it('stores one encrypted configuration and exposes only a redacted admin view', async () => {
  const view = await saveSmtpSettings(admin, input)
  const [row] = await db.select().from(smtpSettings)
  expect(row).toMatchObject({ id: 'smtp', host: input.host, port: 587, security: 'STARTTLS', username: input.username, fromName: input.fromName, fromAddress: input.fromAddress })
  expect(row!.encryptedPassword).not.toContain(input.password)
  expect(decryptSmtpSecret(row!.encryptedPassword!)).toBe(input.password)
  expect(view).toMatchObject({ source: 'ADMIN', configured: true, host: input.host, port: 587, security: 'STARTTLS', username: input.username, fromName: input.fromName, fromAddress: input.fromAddress })
  expect(view.secretChangedAt).toBeInstanceOf(Date)
  expect(JSON.stringify(view)).not.toContain(input.password)
  expect(JSON.stringify(view)).not.toContain(row!.encryptedPassword)
  expect(Object.keys(view)).not.toContain('password')
  expect(Object.keys(view)).not.toContain('encryptedPassword')
  expect(await getSmtpSettings()).toEqual(view)
  expect(await resolveSmtpTransport()).toMatchObject({ ...input })
  const audits = await db.select().from(auditEvent)
  expect(audits).toMatchObject([{ actorId: admin.id, action: 'SMTP_SETTINGS_UPDATE', outcome: 'ALLOWED' }])
  expect(JSON.stringify(audits)).not.toContain(input.password)
})

it('keeps the existing password for an empty update, timestamps only changes, and audits each change', async () => {
  const first = await saveSmtpSettings(admin, input)
  const [stored] = await db.select().from(smtpSettings)
  const second = await saveSmtpSettings(admin, { ...input, fromName: 'Otra clínica', password: '' })
  const [updated] = await db.select().from(smtpSettings)
  expect(updated!.encryptedPassword).toBe(stored!.encryptedPassword)
  expect(second.secretChangedAt).toEqual(first.secretChangedAt)
  expect(second.updatedAt.getTime()).toBeGreaterThanOrEqual(first.updatedAt.getTime())
  expect(await db.select().from(auditEvent)).toHaveLength(2)
  await saveSmtpSettings(admin, { ...input, password: 'secret-two' })
  expect((await resolveSmtpTransport())?.password).toBe('secret-two')
  expect(await db.select().from(auditEvent)).toHaveLength(3)
})

it('denies non-admin writes without changing the row or audit secret contents', async () => {
  await expect(saveSmtpSettings(doctor, input)).rejects.toThrow()
  expect(await db.select().from(smtpSettings)).toHaveLength(0)
  expect(JSON.stringify(await db.select().from(auditEvent))).not.toContain(input.password)
})

it('rejects an initial authenticated account without a password, leaving the database unchanged', async () => {
  await expect(saveSmtpSettings(admin, { ...input, password: '' })).rejects.toThrow()
  expect(await db.select().from(smtpSettings)).toHaveLength(0)
  expect(await db.select().from(auditEvent)).toHaveLength(0)
})

it('prefers admin settings to environment and falls back to environment when no admin row exists', async () => {
  Object.assign(process.env, { SMTP_HOST: 'env.example.test', SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_FROM: 'Env <env@example.test>', SMTP_USER: 'env-user', SMTP_PASS: 'env-pass' })
  expect(await getSmtpSettings()).toMatchObject({ source: 'ENV', configured: true, host: 'env.example.test' })
  expect(JSON.stringify(await getSmtpSettings())).not.toContain('env-pass')
  expect(await resolveSmtpTransport()).toMatchObject({ host: 'env.example.test', password: 'env-pass', security: 'TLS' })
  await saveSmtpSettings(admin, input)
  expect(await getSmtpSettings()).toMatchObject({ source: 'ADMIN', host: input.host })
  expect(await resolveSmtpTransport()).toMatchObject({ host: input.host, password: input.password })
})

it('allows replacing authenticated settings with unauthenticated SMTP without retaining the secret', async () => {
  await saveSmtpSettings(admin, input)
  const view = await saveSmtpSettings(admin, { ...input, username: '', password: '', security: 'NONE' })
  expect(view.secretChangedAt).toBeNull()
  expect((await resolveSmtpTransport())?.password).toBe('')
  expect((await db.select().from(smtpSettings))[0]?.encryptedPassword).toBeNull()
  expect(await db.select().from(auditEvent)).toHaveLength(2)
})

it('requires a fresh password when changing the SMTP destination or username', async () => {
  await saveSmtpSettings(admin, input)
  await expect(saveSmtpSettings(admin, { ...input, host: 'other.example.test', password: '' })).rejects.toThrow()
  await expect(saveSmtpSettings(admin, { ...input, username: 'other-user', password: '' })).rejects.toThrow()
  expect((await resolveSmtpTransport())?.host).toBe(input.host)
  expect(await db.select().from(auditEvent)).toHaveLength(1)
})

it('refuses authenticated plaintext SMTP even with a stored password', async () => {
  await expect(saveSmtpSettings(admin, { ...input, security: 'NONE' })).rejects.toThrow()
  expect(await db.select().from(smtpSettings)).toHaveLength(0)
})

it('fails closed on missing key for secret DB read and write rather than falling back to env', async () => {
  await saveSmtpSettings(admin, input)
  process.env.SMTP_HOST = 'env.example.test'
  process.env.SMTP_PORT = '465'
  process.env.SMTP_FROM = 'env@example.test'
  delete process.env.SMTP_CONFIG_KEY
  await expect(resolveSmtpTransport()).rejects.toThrow()
  await expect(saveSmtpSettings(admin, { ...input, password: 'new-secret' })).rejects.toThrow()
  await expect(saveSmtpSettings(admin, { ...input, fromName: 'changed', password: '' })).rejects.toThrow()
  expect((await db.select().from(smtpSettings).where(eq(smtpSettings.id, 'smtp')))[0]?.host).toBe(input.host)
  expect(await db.select().from(auditEvent)).toHaveLength(1)
})
