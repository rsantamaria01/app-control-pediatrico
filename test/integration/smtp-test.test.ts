import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { sql } from 'drizzle-orm'
import { Pool } from 'pg'
import type { Actor } from '../../shared/types/access'
import { smtpSettingsSchema, smtpTestSchema } from '../../shared/types/smtp'
import { auditEvent } from '../../server/db/schema'
import { testSmtpConnection } from '../../server/services/smtp-test'
import { saveSmtpSettings } from '../../server/services/smtp-settings'

const source = process.env.DATABASE_URL
if (!source || !new URL(source).pathname.includes('pediatrico')) throw new Error('Dedicated pediatric test server required')
const name = `pediatrico_smtp_test_${randomUUID().replaceAll('-', '')}`
const adminUrl = new URL(source)
adminUrl.pathname = '/postgres'
const target = new URL(source)
target.pathname = `/${name}`
const adminPool = new Pool({ connectionString: adminUrl.href })
const pool = new Pool({ connectionString: target.href })
const db = drizzle(pool)
const previousUrl = process.env.DATABASE_URL
const previousKey = process.env.SMTP_CONFIG_KEY
const previousRedis = process.env.REDIS_URL
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
  await db.execute(sql`TRUNCATE TABLE smtp_settings, audit_event RESTART IDENTITY CASCADE`)
  process.env.SMTP_CONFIG_KEY = 'a1'.repeat(32)
})

afterAll(async () => {
  process.env.DATABASE_URL = previousUrl
  if (previousKey === undefined) delete process.env.SMTP_CONFIG_KEY
  else process.env.SMTP_CONFIG_KEY = previousKey
  if (previousRedis === undefined) delete process.env.REDIS_URL
  else process.env.REDIS_URL = previousRedis
  await pool.end()
  const { useDb } = await import('../../server/utils/db')
  await useDb().$client.end()
  try {
    if (created) await adminPool.query(`DROP DATABASE "${name}"`)
  } finally {
    await adminPool.end()
  }
})

it('rejects oversized settings, invalid ports, header injection and malformed test recipients', () => {
  const valid = { host: 'smtp.example.test', port: 587, security: 'STARTTLS', username: 'mailer', password: '', fromName: 'Clínica', fromAddress: 'clinic@example.test' }
  expect(smtpSettingsSchema.safeParse(valid).success).toBe(true)
  for (const changed of [{ host: 'a'.repeat(256) }, { port: 0 }, { port: 65536 }, { port: 587.5 }, { fromName: 'Clinic\r\nBcc: secret' }, { username: 'a'.repeat(256) }, { password: 'a'.repeat(4097) }, { fromAddress: 'invalid' }]) {
    expect(smtpSettingsSchema.safeParse({ ...valid, ...changed }).success).toBe(false)
  }
  expect(smtpTestSchema.safeParse({ email: 'admin@example.test' }).success).toBe(true)
  expect(smtpTestSchema.safeParse({ email: 'admin@example.test\r\nBcc: bad@example.test' }).success).toBe(false)
  expect(smtpTestSchema.safeParse({ email: 'a'.repeat(255) + '@example.test' }).success).toBe(false)
})

it('sends only to the submitted address and audits a successful attempt without exposing transport secrets', async () => {
  await saveSmtpSettings(admin, { host: 'smtp.example.test', port: 587, security: 'STARTTLS', username: 'mailer', password: 'super-secret', fromName: 'Clínica', fromAddress: 'clinic@example.test' })
  const sent: string[][] = []
  const result = await testSmtpConnection(admin, 'recipient@example.test', '192.0.2.1', {
    limit: async () => true,
    send: async (...args) => { sent.push(args) }
  })
  expect(result).toEqual({ sent: true })
  expect(sent).toEqual([['recipient@example.test', 'Correo de prueba · Control Pediátrico', 'Este es un correo de prueba de la configuración de la clínica.']])
  const audits = await db.select().from(auditEvent)
  expect(audits).toMatchObject([{ action: 'SMTP_SETTINGS_UPDATE', outcome: 'ALLOWED' }, { action: 'SMTP_TEST_SEND', outcome: 'ALLOWED', actorId: admin.id }])
  expect(JSON.stringify({ result, audits })).not.toContain('super-secret')
  expect(JSON.stringify({ result, audits })).not.toContain('recipient@example.test')
})

it('denies a non-admin before touching the limiter or sender', async () => {
  await expect(testSmtpConnection(doctor, 'recipient@example.test', '192.0.2.1', {
    limit: async () => { throw new Error('limiter called') },
    send: async () => { throw new Error('sender called') }
  })).rejects.toMatchObject({ statusCode: 403 })
  expect(await db.select().from(auditEvent)).toHaveLength(0)
})

it('fails closed on denied or unavailable Valkey and never sends', async () => {
  const sent: string[] = []
  const send = async (email: string) => {
    sent.push(email)
  }
  await expect(testSmtpConnection(admin, 'recipient@example.test', '192.0.2.1', { limit: async () => false, send })).rejects.toMatchObject({ statusCode: 429 })
  await expect(testSmtpConnection(admin, 'recipient@example.test', '192.0.2.1', {
    limit: async () => { throw new Error('redis://secret') }, send
  })).rejects.toMatchObject({ statusCode: 503 })
  delete process.env.REDIS_URL
  await expect(testSmtpConnection(admin, 'recipient@example.test', '192.0.2.1', { send })).rejects.toMatchObject({ statusCode: 503 })
  expect(sent).toEqual([])
  expect(JSON.stringify(await db.select().from(auditEvent))).not.toContain('redis://secret')
})

it('reports only the SMTP status code from a rejected provider response', async () => {
  await expect(testSmtpConnection(admin, 'recipient@example.test', '192.0.2.1', {
    limit: async () => true, send: async () => { throw new Error('Email delivery failed (SMTP 550)') }
  })).rejects.toMatchObject({ statusCode: 502, statusMessage: 'El servidor SMTP rechazó el correo (550)' })
  expect(await db.select().from(auditEvent)).toMatchObject([{ action: 'SMTP_TEST_SEND', outcome: 'DENIED' }])
})

it('classifies provider failure without returning credentials, recipient or provider error and audits failure', async () => {
  const secret = 'smtp://mailer:super-secret@smtp.example.test'
  await expect(testSmtpConnection(admin, 'recipient@example.test', '192.0.2.1', {
    limit: async () => true, send: async () => { throw new Error(secret) }
  })).rejects.toMatchObject({ statusCode: 502, statusMessage: 'No se pudo enviar el correo de prueba' })
  const audits = await db.select().from(auditEvent)
  expect(audits).toMatchObject([{ action: 'SMTP_TEST_SEND', outcome: 'DENIED', actorId: admin.id }])
  expect(JSON.stringify(audits)).not.toContain(secret)
  expect(JSON.stringify(audits)).not.toContain('recipient@example.test')
})
