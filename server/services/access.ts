import { eq } from 'drizzle-orm'
import { createError, type H3Event } from 'h3'
import type { Actor, Capability, Role } from '../../shared/types/access'
import { roles } from '../../shared/types/access'
import { userRole } from '../db/schema'
import { useDb } from '../utils/db'
import { recordAudit } from './audit'

const permissions: Record<Capability, Role[]> = {
  ADMINISTER: ['ADMIN'],
  AUDIT_READ: ['ADMIN'],
  CLINICAL_READ: ['DOCTOR'],
  CLINICAL_WRITE: ['DOCTOR'],
  SCHEDULE: ['DOCTOR', 'ASSISTANT'],
  GUARDIAN_GRANT: ['DOCTOR', 'ASSISTANT'],
  PORTAL_READ: ['PATIENT']
}

export async function resolveActor(event: H3Event): Promise<Actor | null> {
  const session = await getUserSession(event)
  if (!session?.user?.id) return null
  const rows = await useDb().select({ role: userRole.role }).from(userRole).where(eq(userRole.userId, session.user.id))
  if (!rows.length || rows.some(row => !roles.includes(row.role as Role))) return null
  return { id: session.user.id, roles: rows.map(row => row.role as Role) }
}

export async function requireCapability(event: H3Event, capability: Capability, patientId?: string): Promise<Actor> {
  const session = await getUserSession(event)
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  const actor = await resolveActor(event)
  const allowed = Boolean(actor && permissions[capability]?.some(role => actor.roles.includes(role)) && (capability !== 'PORTAL_READ' || !patientId))
  await recordAudit(capability, allowed ? 'ALLOWED' : 'DENIED', session.user.id, patientId)
  if (!allowed || !actor) throw createError({ statusCode: 403, statusMessage: 'Access denied' })
  return actor
}
