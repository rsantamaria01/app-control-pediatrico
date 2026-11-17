import { and, eq } from 'drizzle-orm'
import { createError, type H3Event } from 'h3'
import type { Actor, Capability, Role } from '../../shared/types/access'
import { roles } from '../../shared/types/access'
import { session as dbSession, userRole } from '../db/schema'
import { useDb } from '../utils/db'
import { recordAudit } from './audit'
import { emulatedActor } from './role-emulation'

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
  if (process.env.ALLOW_ROLE_EMULATION === 'true') {
    const [state] = await useDb().select({ emulatedRole: dbSession.emulatedRole, emulatedUserId: dbSession.emulatedUserId }).from(dbSession).where(and(eq(dbSession.id, session.session.id), eq(dbSession.userId, session.user.id)))
    if (!state) return null
    if (state.emulatedRole || state.emulatedUserId) {
      if (!rows.some(row => row.role === 'ADMIN')) return null
      const emulated = await emulatedActor(event)
      if (!emulated) return null
      return emulated
    }
  }
  return { id: session.user.id, roles: rows.map(row => row.role as Role) }
}

export async function requireCapability(event: H3Event, capability: Capability, patientId?: string): Promise<Actor> {
  const session = await getUserSession(event)
  if (!session?.user?.id) {
    await recordAudit(capability, 'DENIED', undefined, patientId)
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
  const actor = await resolveActor(event)
  const allowed = Boolean(actor && permissions[capability]?.some(role => actor.roles.includes(role)))
  await recordAudit(capability, allowed ? 'ALLOWED' : 'DENIED', session.user.id, patientId)
  if (!allowed || !actor) throw createError({ statusCode: 403, statusMessage: 'Access denied' })
  return actor
}
