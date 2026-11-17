import { and, eq, ilike, sql } from 'drizzle-orm'
import { createError, type H3Event } from 'h3'
import type { Actor, Role } from '../../shared/types/access'
import { auditEvent, guardianGrant, session, user, userRole } from '../db/schema'
import { useDb } from '../utils/db'

export const emulationEnabled = () => process.env.ALLOW_ROLE_EMULATION === 'true'

export async function actualAdmin(event: H3Event) {
  const auth = await getUserSession(event)
  if (!auth?.user?.id || !auth.session?.id) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  const [role] = await useDb().select({ role: userRole.role }).from(userRole).where(and(eq(userRole.userId, auth.user.id), eq(userRole.role, 'ADMIN')))
  if (!role) throw createError({ statusCode: 403, statusMessage: 'Access denied' })
  const [row] = await useDb().select().from(session).where(and(eq(session.id, auth.session.id), eq(session.userId, auth.user.id)))
  if (!row || row.expiresAt <= new Date()) throw createError({ statusCode: 401, statusMessage: 'Session expired' })
  return { adminId: auth.user.id, row }
}

export async function emulationState(event: H3Event) {
  if (!emulationEnabled()) return null
  const auth = await getUserSession(event)
  if (!auth?.user?.id || !auth.session?.id) return null
  const [admin] = await useDb().select({ userId: userRole.userId }).from(userRole).where(and(eq(userRole.userId, auth.user.id), eq(userRole.role, 'ADMIN')))
  if (!admin) return null
  const [row] = await useDb().select().from(session).where(and(eq(session.id, auth.session.id), eq(session.userId, admin.userId)))
  if (!row || row.expiresAt <= new Date()) return null
  if (!row.emulatedRole) {
    if (row.emulatedUserId) throw createError({ statusCode: 403, statusMessage: 'Invalid emulation state' })
    return null
  }
  if (!['ADMIN', 'DOCTOR', 'ASSISTANT', 'PATIENT'].includes(row.emulatedRole)) throw createError({ statusCode: 403, statusMessage: 'Invalid emulation state' })
  if (row.emulatedRole === 'PATIENT') {
    if (!row.emulatedUserId) throw createError({ statusCode: 403, statusMessage: 'Invalid emulation state' })
    const [guardian] = await useDb().selectDistinct({ name: user.name }).from(user).innerJoin(userRole, and(eq(userRole.userId, user.id), eq(userRole.role, 'PATIENT'))).innerJoin(guardianGrant, and(eq(guardianGrant.guardianId, user.id), eq(guardianGrant.status, 'ACTIVE'))).where(eq(user.id, row.emulatedUserId))
    if (!guardian) throw createError({ statusCode: 403, statusMessage: 'Invalid emulation state' })
    return { adminId: admin.userId, role: 'PATIENT' as Role, userId: row.emulatedUserId, name: guardian.name, sessionId: row.id }
  }
  if (row.emulatedUserId) throw createError({ statusCode: 403, statusMessage: 'Invalid emulation state' })
  return { adminId: admin.userId, role: row.emulatedRole as Role, userId: null, name: null, sessionId: row.id }
}

export async function emulatedActor(event: H3Event): Promise<Actor | null> {
  const state = await emulationState(event)
  return state ? { id: state.userId ?? state.adminId, roles: [state.role] } : null
}

export async function setEmulation(event: H3Event, role: Role | null, guardianId?: string) {
  if (!emulationEnabled()) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const { adminId, row } = await actualAdmin(event)
  if (role && !['ADMIN', 'DOCTOR', 'ASSISTANT', 'PATIENT'].includes(role)) throw createError({ statusCode: 400, statusMessage: 'Invalid role' })
  if ((role === 'PATIENT') !== Boolean(guardianId)) throw createError({ statusCode: 400, statusMessage: 'Select guardian account' })
  if (guardianId) {
    const [guardian] = await useDb().select({ id: user.id }).from(user).innerJoin(userRole, and(eq(userRole.userId, user.id), eq(userRole.role, 'PATIENT'))).where(eq(user.id, guardianId))
    const [grant] = await useDb().select({ guardianId: guardianGrant.guardianId }).from(guardianGrant).where(and(eq(guardianGrant.guardianId, guardianId), eq(guardianGrant.status, 'ACTIVE'))).limit(1)
    if (!guardian || !grant) throw createError({ statusCode: 404, statusMessage: 'Guardian not found' })
  }
  await useDb().transaction(async (tx) => {
    const [current] = await tx.select().from(session).where(and(eq(session.id, row.id), eq(session.userId, adminId))).for('update')
    if (!current || current.expiresAt <= new Date() || (role && current.emulatedRole)) throw createError({ statusCode: 409, statusMessage: 'Emulación ya activa o sesión vencida' })
    await tx.update(session).set({ emulatedRole: role, emulatedUserId: guardianId ?? null }).where(eq(session.id, row.id))
    await tx.insert(auditEvent).values({ id: crypto.randomUUID(), actorId: adminId, action: role ? 'ROLE_EMULATION_START' : 'ROLE_EMULATION_STOP', outcome: 'ALLOWED', subjectId: guardianId ?? adminId, emulatedRole: role ?? current.emulatedRole, emulatedUserId: guardianId ?? current.emulatedUserId })
  })
}

export async function listEmulatableGuardians(event: H3Event, query: string) {
  if (!emulationEnabled()) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  await actualAdmin(event)
  const search = query.trim().slice(0, 80).replace(/[\\%_]/g, '\\$&')
  return useDb().selectDistinct({ id: user.id, name: user.name, username: user.username }).from(user).innerJoin(userRole, and(eq(userRole.userId, user.id), eq(userRole.role, 'PATIENT'))).innerJoin(guardianGrant, and(eq(guardianGrant.guardianId, user.id), eq(guardianGrant.status, 'ACTIVE'))).where(search ? ilike(sql`unaccent(${user.name} || ' ' || coalesce(${user.username}, ''))`, `%${search}%`) : undefined).orderBy(user.name).limit(30)
}
