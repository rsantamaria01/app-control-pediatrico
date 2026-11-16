import { and, eq } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import type { Actor } from '../../shared/types/access'
import { notificationPreference } from '../db/schema'
import { useDb } from '../utils/db'

function requireGuardian(actor: Actor) {
  if (actor.roles.length !== 1 || actor.roles[0] !== 'PATIENT') throw createError({ statusCode: 403, statusMessage: 'Access denied' })
}

export async function getNoticePreferences(actor: Actor): Promise<{ inApp: true, email: boolean }> {
  requireGuardian(actor)
  const [row] = await useDb().select({ enabled: notificationPreference.enabled }).from(notificationPreference).where(and(eq(notificationPreference.userId, actor.id), eq(notificationPreference.channel, 'EMAIL')))
  return { inApp: true, email: row?.enabled === true }
}

export async function setEmailNoticePreference(actor: Actor, enabled: boolean): Promise<{ inApp: true, email: boolean }> {
  requireGuardian(actor)
  await useDb().insert(notificationPreference).values({ userId: actor.id, channel: 'EMAIL', enabled }).onConflictDoUpdate({ target: [notificationPreference.userId, notificationPreference.channel], set: { enabled } })
  return { inApp: true, email: enabled }
}
