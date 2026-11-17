import { eq } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import { z } from 'zod'
import type { Actor } from '../../shared/types/access'
import { notificationPreference } from '../db/schema'
import { useDb } from '../utils/db'

export const noticePreferencesSchema = z.strictObject({ email: z.boolean().optional(), whatsapp: z.boolean().optional() }).refine(input => input.email !== undefined || input.whatsapp !== undefined)

function requireGuardian(actor: Actor) {
  if (actor.roles.length !== 1 || actor.roles[0] !== 'PATIENT') throw createError({ statusCode: 403, statusMessage: 'Access denied' })
}

export async function getNoticePreferences(actor: Actor): Promise<{ inApp: true, email: boolean, whatsapp: boolean }> {
  requireGuardian(actor)
  const rows = await useDb().select({ channel: notificationPreference.channel, enabled: notificationPreference.enabled }).from(notificationPreference).where(eq(notificationPreference.userId, actor.id))
  return {
    inApp: true,
    email: rows.some(row => row.channel === 'EMAIL' && row.enabled),
    whatsapp: rows.some(row => row.channel === 'WHATSAPP' && row.enabled)
  }
}

async function setNoticePreference(actor: Actor, channel: 'EMAIL' | 'WHATSAPP', enabled: boolean) {
  requireGuardian(actor)
  await useDb().insert(notificationPreference).values({ userId: actor.id, channel, enabled }).onConflictDoUpdate({ target: [notificationPreference.userId, notificationPreference.channel], set: { enabled } })
  return getNoticePreferences(actor)
}

export async function setEmailNoticePreference(actor: Actor, enabled: boolean) {
  return setNoticePreference(actor, 'EMAIL', enabled)
}

export async function setWhatsAppNoticePreference(actor: Actor, enabled: boolean) {
  return setNoticePreference(actor, 'WHATSAPP', enabled)
}
