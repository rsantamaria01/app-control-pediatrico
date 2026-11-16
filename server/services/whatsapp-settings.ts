import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { Actor } from '../../shared/types/access'
import type { WhatsAppSettingsInput, WhatsAppSettingsView, WhatsAppTransport } from '../../shared/types/notification'
import { auditEvent } from '../db/schema'
import { whatsappHealth, whatsappSettings } from '../db/schema/notifications'
import { useDb } from '../utils/db'

function key(): Buffer {
  const raw = process.env.WHATSAPP_CONFIG_KEY
  if (!raw || !/^[a-f\d]{64}$/i.test(raw)) throw new Error('WhatsApp configuration key unavailable')
  return Buffer.from(raw, 'hex')
}

function encrypt(secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const value = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return `v1:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${value.toString('hex')}`
}

function decrypt(value: string): string {
  const parts = /^v1:([a-f\d]{24}):([a-f\d]{32}):([a-f\d]+)$/i.exec(value)
  if (!parts) throw new Error('Invalid WhatsApp configuration secret')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(parts[1]!, 'hex'))
  decipher.setAuthTag(Buffer.from(parts[2]!, 'hex'))
  try {
    return Buffer.concat([decipher.update(Buffer.from(parts[3]!, 'hex')), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('Invalid WhatsApp configuration secret')
  }
}

function valid(input: WhatsAppSettingsInput): boolean {
  if (!input || typeof input.secret !== 'string' || (input.secret.length > 0 && !input.secret.trim())) return false
  if (input.provider === 'META') return /^\d{5,30}$/.test(input.sender) && /^[a-z][a-z\d_]{1,100}$/.test(input.template) && /^[a-z]{2}(?:_[A-Z]{2})?$/.test(input.language)
  return input.provider === 'TWILIO' && /^\+[1-9]\d{7,14}$/.test(input.sender) && /^AC[a-f\d]{32}$/i.test(input.accountSid) && /^HX[a-f\d]{32}$/i.test(input.template)
}

function environment(): WhatsAppTransport | null {
  const provider = process.env.WHATSAPP_PROVIDER
  if (provider === 'META') {
    const input = { provider: 'META' as const, sender: process.env.WHATSAPP_META_PHONE_NUMBER_ID ?? '', template: process.env.WHATSAPP_META_TEMPLATE ?? '', language: process.env.WHATSAPP_META_LANGUAGE ?? '', secret: process.env.WHATSAPP_META_TOKEN ?? '' }
    return valid(input) && !!input.secret ? input : null
  }
  if (provider === 'TWILIO') {
    const input = { provider: 'TWILIO' as const, sender: process.env.WHATSAPP_TWILIO_FROM ?? '', accountSid: process.env.WHATSAPP_TWILIO_ACCOUNT_SID ?? '', template: process.env.WHATSAPP_TWILIO_CONTENT_SID ?? '', secret: process.env.WHATSAPP_TWILIO_AUTH_TOKEN ?? '' }
    return valid(input) && !!input.secret ? input : null
  }
  return null
}

function view(row: typeof whatsappSettings.$inferSelect): WhatsAppSettingsView {
  return { source: 'ADMIN', configured: true, provider: row.provider as 'META' | 'TWILIO', sender: row.sender, template: row.template, accountSid: row.accountSid, language: row.language, updatedAt: row.updatedAt, secretChangedAt: row.secretChangedAt }
}

export async function getWhatsAppSettings(): Promise<WhatsAppSettingsView> {
  if (process.env.WHATSAPP_PROVIDER !== undefined) {
    const env = environment()
    return { source: 'ENV', configured: Boolean(env), provider: process.env.WHATSAPP_PROVIDER === 'META' || process.env.WHATSAPP_PROVIDER === 'TWILIO' ? process.env.WHATSAPP_PROVIDER : null, sender: env?.sender ?? null, template: env?.template ?? null, accountSid: env?.provider === 'TWILIO' ? env.accountSid : null, language: env?.provider === 'META' ? env.language : null, updatedAt: null, secretChangedAt: null }
  }
  const [row] = await useDb().select().from(whatsappSettings).where(eq(whatsappSettings.id, 'whatsapp'))
  if (row) {
    try {
      return { ...view(row), configured: Boolean(decrypt(row.encryptedSecret)) }
    } catch {
      return { ...view(row), configured: false }
    }
  }
  return { source: 'ADMIN', configured: false, provider: null, sender: null, template: null, accountSid: null, language: null, updatedAt: null, secretChangedAt: null }
}

export async function saveWhatsAppSettings(actor: Actor, input: WhatsAppSettingsInput): Promise<WhatsAppSettingsView> {
  if (!actor?.id || !actor.roles?.includes('ADMIN')) throw new Error('Access denied')
  if (!valid(input)) throw new Error('Invalid WhatsApp settings')
  key()
  return useDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(571458, 2)`)
    const [existing] = await tx.select().from(whatsappSettings).where(eq(whatsappSettings.id, 'whatsapp'))
    if (existing) decrypt(existing.encryptedSecret)
    const accountSid = input.provider === 'TWILIO' ? input.accountSid : null
    const language = input.provider === 'META' ? input.language : null
    if (!input.secret && (!existing || existing.provider !== input.provider || existing.sender !== input.sender || existing.accountSid !== accountSid || existing.template !== input.template || existing.language !== language)) throw new Error('New WhatsApp secret required for changed provider')
    const now = new Date()
    const values = { provider: input.provider, sender: input.sender, template: input.template, accountSid, language, encryptedSecret: input.secret ? encrypt(input.secret) : existing!.encryptedSecret, updatedAt: now, secretChangedAt: input.secret ? now : existing!.secretChangedAt }
    const [row] = await tx.insert(whatsappSettings).values({ id: 'whatsapp', ...values }).onConflictDoUpdate({ target: whatsappSettings.id, set: values }).returning()
    await tx.insert(auditEvent).values({ id: randomUUID(), actorId: actor.id, action: 'WHATSAPP_SETTINGS_UPDATE', subjectId: 'whatsapp', outcome: 'ALLOWED' })
    return view(row!)
  })
}

export async function resolveWhatsAppTransport(): Promise<WhatsAppTransport | null> {
  if (process.env.WHATSAPP_PROVIDER !== undefined) return environment()
  const [row] = await useDb().select().from(whatsappSettings).where(eq(whatsappSettings.id, 'whatsapp'))
  if (!row) return null
  const input = { provider: row.provider, sender: row.sender, template: row.template, accountSid: row.accountSid ?? '', language: row.language ?? '', secret: decrypt(row.encryptedSecret) } as WhatsAppSettingsInput
  return valid(input) ? input : null
}

function healthId(config: WhatsAppTransport): string {
  return createHash('sha256').update(JSON.stringify([config.provider, config.sender, config.template, config.provider === 'META' ? config.language : config.accountSid, config.secret])).digest('hex')
}

export async function whatsappProviderHealth(): Promise<'READY' | 'NOT_CONFIGURED' | 'FAILED'> {
  try {
    const config = await resolveWhatsAppTransport()
    if (!config) return 'NOT_CONFIGURED'
    const [row] = await useDb().select({ state: whatsappHealth.state }).from(whatsappHealth).where(eq(whatsappHealth.id, healthId(config)))
    return row?.state === 'FAILING' ? 'FAILED' : 'READY'
  } catch { return 'NOT_CONFIGURED' }
}

export async function setWhatsAppHealth(config: WhatsAppTransport, state: 'READY' | 'FAILING'): Promise<void> {
  await useDb().insert(whatsappHealth).values({ id: healthId(config), state, updatedAt: new Date() }).onConflictDoUpdate({ target: whatsappHealth.id, set: { state, updatedAt: new Date() } })
}
