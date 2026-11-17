import { eq } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { user, userRole } from '../db/schema'
import { resolveActor } from '../services/access'
import { useDb } from '../utils/db'

export default defineEventHandler(async (event) => {
  const actor = await resolveActor(event)
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  const [identity] = await useDb().select({ name: user.name, email: user.email, username: user.username }).from(user).where(eq(user.id, actor.id))
  if (!identity) throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  const roles = await useDb().select({ role: userRole.role }).from(userRole).where(eq(userRole.userId, actor.id))
  return { ...identity, roles: roles.map(row => row.role) }
})
