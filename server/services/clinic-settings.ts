import { eq } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import { z } from 'zod'
import type { Actor } from '../../shared/types/access'
import type { ClinicSettings, ClinicSettingsInput } from '../../shared/types/admin'
import { auditEvent, clinicSettings } from '../db/schema'
import { useDb } from '../utils/db'
import { recordAudit } from './audit'

export const clinicSettingsSchema = z.strictObject({
  name: z.string().trim().min(2).max(160),
  contactEmail: z.string().trim().pipe(z.email().max(254)).transform(value => value.toLowerCase()),
  primary: z.enum(['brand', 'teal', 'indigo', 'violet', 'rose', 'emerald']),
  logo: z.union([z.literal(null), z.string().regex(/^\/branding\/[a-zA-Z0-9_-]+\.(png|webp|svg)$/)])
})

function projection(row: typeof clinicSettings.$inferSelect): ClinicSettings {
  return { name: row.name, contactEmail: row.contactEmail, primary: row.primary as ClinicSettings['primary'], logo: row.logo, updatedAt: row.updatedAt }
}

export async function getClinicSettings(): Promise<ClinicSettings | null> {
  const [row] = await useDb().select().from(clinicSettings).where(eq(clinicSettings.id, 'clinic'))
  return row ? projection(row) : null
}

export async function getPublicClinicBrand(): Promise<{ primary: ClinicSettings['primary'], logo: string | null }> {
  const saved = await getClinicSettings()
  const primary = clinicSettingsSchema.shape.primary.safeParse(saved?.primary ?? process.env.NUXT_PUBLIC_CLINIC_PRIMARY)
  const logo = clinicSettingsSchema.shape.logo.safeParse(saved ? saved.logo : process.env.NUXT_PUBLIC_CLINIC_LOGO)
  return { primary: primary.success ? primary.data : 'brand', logo: logo.success ? logo.data : null }
}

export async function getClinicReportBrand(): Promise<{ primary: string, logo: string }> {
  const saved = await getClinicSettings()
  return { primary: saved?.primary ?? process.env.NUXT_PUBLIC_CLINIC_PRIMARY ?? 'brand', logo: saved?.logo ?? process.env.NUXT_PUBLIC_CLINIC_LOGO ?? '' }
}

export async function updateClinicSettings(actor: Actor, input: ClinicSettingsInput): Promise<ClinicSettings> {
  if (!actor.roles.includes('ADMIN')) {
    await recordAudit('CLINIC_SETTINGS_UPDATE', 'DENIED', actor.id)
    throw createError({ statusCode: 403, statusMessage: 'Access denied' })
  }
  const parsed = clinicSettingsSchema.safeParse(input)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid clinic settings' })
  return useDb().transaction(async (tx) => {
    const [row] = await tx.insert(clinicSettings).values({ id: 'clinic', ...parsed.data, updatedBy: actor.id }).onConflictDoUpdate({ target: clinicSettings.id, set: { ...parsed.data, updatedBy: actor.id, updatedAt: new Date() } }).returning()
    await tx.insert(auditEvent).values({ id: crypto.randomUUID(), action: 'CLINIC_SETTINGS_UPDATE', outcome: 'ALLOWED', actorId: actor.id })
    return projection(row!)
  })
}
