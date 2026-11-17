import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { Actor } from '../../shared/types/access'
import type { SmtpSecurity, SmtpSettingsInput, SmtpSettingsView, SmtpTransportConfig } from '../../shared/types/smtp'
import { auditEvent, smtpSettings } from '../db/schema'
import { useDb } from '../utils/db'

function configKey(): Buffer {
  const value = process.env.SMTP_CONFIG_KEY
  if (!value || !/^[0-9a-fA-F]{64}$/.test(value)) throw new Error('SMTP configuration key unavailable')
  return Buffer.from(value, 'hex')
}

export function encryptSmtpSecret(secret: string): string {
  const key = configKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return `v1:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptSmtpSecret(value: string): string {
  const key = configKey()
  const parts = /^v1:([0-9a-f]{24}):([0-9a-f]{32}):([0-9a-f]*)$/.exec(value)
  if (!parts) throw new Error('Invalid SMTP configuration secret')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1]!, 'hex'))
  decipher.setAuthTag(Buffer.from(parts[2]!, 'hex'))
  try {
    return Buffer.concat([decipher.update(Buffer.from(parts[3]!, 'hex')), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('Invalid SMTP configuration secret')
  }
}

function adminView(row: typeof smtpSettings.$inferSelect): SmtpSettingsView {
  return {
    source: 'ADMIN', configured: true, host: row.host, port: row.port,
    security: row.security as SmtpSecurity, username: row.username,
    fromName: row.fromName, fromAddress: row.fromAddress,
    updatedAt: row.updatedAt, secretChangedAt: row.secretChangedAt
  }
}

function envSettings(): SmtpTransportConfig | null {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT)
  const from = process.env.SMTP_FROM
  const username = process.env.SMTP_USER ?? ''
  const password = process.env.SMTP_PASS ?? ''
  if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535 || Boolean(username) !== Boolean(password)) return null
  if (process.env.SMTP_SECURE !== undefined && !['true', 'false'].includes(process.env.SMTP_SECURE)) return null
  const match = /^([^<>]*)<([^<>]+)>$/.exec(from.trim())
  return {
    host, port, security: process.env.SMTP_SECURE === 'true' ? 'TLS' : username ? 'STARTTLS' : process.env.SMTP_SECURE === 'false' ? 'NONE' : 'STARTTLS',
    username, password, fromName: match ? match[1]!.trim() : '', fromAddress: match ? match[2]!.trim() : from
  }
}

function validate(input: SmtpSettingsInput) {
  if (!input.host?.trim() || /[\r\n]/.test(input.host) || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535 || !['NONE', 'STARTTLS', 'TLS'].includes(input.security) || typeof input.username !== 'string' || typeof input.password !== 'string' || typeof input.fromName !== 'string' || typeof input.fromAddress !== 'string' || !/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(input.fromAddress) || /[\r\n]/.test(input.fromName) || /[\r\n]/.test(input.username)) throw new Error('Invalid SMTP settings')
}

export async function getSmtpSettings(): Promise<SmtpSettingsView> {
  const [row] = await useDb().select({
    id: smtpSettings.id, host: smtpSettings.host, port: smtpSettings.port, security: smtpSettings.security,
    username: smtpSettings.username, fromName: smtpSettings.fromName, fromAddress: smtpSettings.fromAddress,
    updatedAt: smtpSettings.updatedAt, secretChangedAt: smtpSettings.secretChangedAt
  }).from(smtpSettings).where(eq(smtpSettings.id, 'smtp'))
  if (row) return adminView({ ...row, encryptedPassword: null })
  const env = envSettings()
  return {
    source: 'ENV', configured: Boolean(env), host: env?.host ?? null, port: env?.port ?? null,
    security: env?.security ?? null, username: env?.username ?? null, fromName: env?.fromName ?? null,
    fromAddress: env?.fromAddress ?? null, updatedAt: null, secretChangedAt: null
  }
}

export async function saveSmtpSettings(actor: Actor, input: SmtpSettingsInput): Promise<SmtpSettingsView> {
  if (!actor?.id || !actor.roles?.includes('ADMIN')) throw new Error('Access denied')
  validate(input)
  configKey()
  const db = useDb()
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(571458, 1)`)
    const [existing] = await tx.select().from(smtpSettings).where(eq(smtpSettings.id, 'smtp'))
    if (existing?.encryptedPassword) decryptSmtpSecret(existing.encryptedPassword)
    if (!input.password && input.username && !existing?.encryptedPassword) throw new Error('SMTP password required')
    if (!input.username && input.password) throw new Error('SMTP username required')
    if (input.username && input.security === 'NONE') throw new Error('Authenticated SMTP requires TLS')
    if (input.username && existing?.encryptedPassword && !input.password && (input.host.trim() !== existing.host || input.port !== existing.port || input.username !== existing.username || input.security !== existing.security)) throw new Error('New SMTP password required when connection changes')
    const now = new Date()
    const encryptedPassword = !input.username ? null : input.password ? encryptSmtpSecret(input.password) : existing?.encryptedPassword ?? null
    const secretChangedAt = !input.username ? null : input.password ? now : existing?.secretChangedAt ?? null
    const values = {
      host: input.host.trim(), port: input.port, security: input.security, username: input.username,
      fromName: input.fromName.trim(), fromAddress: input.fromAddress.trim(), encryptedPassword,
      updatedAt: now, secretChangedAt
    }
    const [row] = await tx.insert(smtpSettings).values({ id: 'smtp', ...values })
      .onConflictDoUpdate({ target: smtpSettings.id, set: values }).returning()
    await tx.insert(auditEvent).values({ id: randomUUID(), actorId: actor.id, action: 'SMTP_SETTINGS_UPDATE', subjectId: 'smtp', outcome: 'ALLOWED' })
    return adminView(row!)
  })
}

export async function resolveSmtpTransport(): Promise<SmtpTransportConfig | null> {
  const [row] = await useDb().select().from(smtpSettings).where(eq(smtpSettings.id, 'smtp'))
  if (!row) return envSettings()
  configKey()
  return {
    host: row.host, port: row.port, security: row.security as SmtpSecurity,
    username: row.username, password: row.encryptedPassword ? decryptSmtpSecret(row.encryptedPassword) : '',
    fromName: row.fromName, fromAddress: row.fromAddress
  }
}
