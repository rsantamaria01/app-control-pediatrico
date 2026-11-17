import { and, asc, count, desc, eq, exists, gte, inArray, lte, notExists, sql } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import type { Actor, Role } from '../../shared/types/access'
import type { AuditFilter, AuditPage, StaffMember } from '../../shared/types/admin'
import { account, auditEvent, session, setupToken, user, userRole } from '../db/schema'
import { useDb } from '../utils/db'
import { recordAudit } from './audit'

async function requireAdmin(actor: Actor, action: string) {
  if (actor.roles.includes('ADMIN')) return
  await recordAudit(action, 'DENIED', actor.id)
  throw createError({ statusCode: 403, statusMessage: 'Access denied' })
}

function validStaffRoles(roles: Role[]) {
  return Array.isArray(roles) && roles.length > 0 && new Set(roles).size === roles.length && roles.every(role => ['ADMIN', 'DOCTOR', 'ASSISTANT'].includes(role))
}

function filterAudit(filter: AuditFilter) {
  if (!Number.isSafeInteger(filter.page) || filter.page < 1 || !Number.isSafeInteger(filter.pageSize) || filter.pageSize < 1 || filter.pageSize > 100 || (filter.from && !Number.isFinite(filter.from.getTime())) || (filter.to && !Number.isFinite(filter.to.getTime())) || (filter.from && filter.to && filter.from > filter.to)) throw createError({ statusCode: 400, statusMessage: 'Invalid audit filter' })
  return and(filter.action ? eq(auditEvent.action, filter.action) : undefined, filter.actorId ? eq(auditEvent.actorId, filter.actorId) : undefined, filter.outcome ? eq(auditEvent.outcome, filter.outcome) : undefined, filter.from ? gte(auditEvent.occurredAt, filter.from) : undefined, filter.to ? lte(auditEvent.occurredAt, filter.to) : undefined)
}

const auditColumns = { id: auditEvent.id, actorId: auditEvent.actorId, action: auditEvent.action, subjectId: auditEvent.subjectId, outcome: auditEvent.outcome, occurredAt: auditEvent.occurredAt }

export async function listAudit(actor: Actor, filter: AuditFilter): Promise<AuditPage> {
  await requireAdmin(actor, 'AUDIT_READ')
  const where = filterAudit(filter)
  const db = useDb()
  const [total] = await db.select({ count: count() }).from(auditEvent).where(where)
  const items = await db.select(auditColumns).from(auditEvent).where(where).orderBy(desc(auditEvent.occurredAt), desc(auditEvent.id)).limit(filter.pageSize).offset((filter.page - 1) * filter.pageSize)
  return { items, page: filter.page, pageSize: filter.pageSize, total: total!.count }
}

function csvCell(value: string) {
  const safe = /^[\s]*[=+@\-\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

export async function exportAuditCsv(actor: Actor, filter: AuditFilter): Promise<string> {
  await requireAdmin(actor, 'AUDIT_EXPORT')
  filterAudit(filter)
  const where = filterAudit(filter)
  const rows = await useDb().select(auditColumns).from(auditEvent).where(where).orderBy(asc(auditEvent.occurredAt), asc(auditEvent.id)).limit(10000)
  if (rows.length === 10000) throw createError({ statusCode: 413, statusMessage: 'Audit export too large; narrow filters' })
  const lines = ['id,actorId,action,subjectId,outcome,occurredAt', ...rows.map(row => [row.id, row.actorId ?? '', row.action, row.subjectId ?? '', row.outcome, row.occurredAt.toISOString()].map(csvCell).join(','))]
  await recordAudit('AUDIT_EXPORT', 'ALLOWED', actor.id)
  return lines.join('\n')
}

export async function listStaff(actor: Actor): Promise<StaffMember[]> {
  await requireAdmin(actor, 'STAFF_READ')
  const db = useDb()
  const rows = await db.select({ id: user.id, name: user.name, email: user.email, role: userRole.role, credentialed: exists(db.select({ id: account.id }).from(account).where(and(eq(account.userId, user.id), eq(account.providerId, 'credential'), sql`${account.password} IS NOT NULL`))) }).from(user).innerJoin(userRole, eq(user.id, userRole.userId)).where(inArray(userRole.role, ['ADMIN', 'DOCTOR', 'ASSISTANT'])).orderBy(asc(user.name), asc(user.id))
  const former = await db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(and(
    exists(db.select({ id: account.id }).from(account).where(and(eq(account.userId, user.id), eq(account.providerId, 'credential'), sql`${account.password} IS NOT NULL`))),
    exists(db.select({ id: auditEvent.id }).from(auditEvent).where(and(eq(auditEvent.subjectId, user.id), eq(auditEvent.action, 'STAFF_DEACTIVATE'), eq(auditEvent.outcome, 'ALLOWED')))),
    notExists(db.select({ role: userRole.role }).from(userRole).where(eq(userRole.userId, user.id)))
  )).orderBy(asc(user.name), asc(user.id))
  const members = new Map<string, StaffMember>()
  for (const row of rows) {
    if (!members.has(row.id)) members.set(row.id, { id: row.id, name: row.name, email: row.email, roles: [], active: row.credentialed === true })
    members.get(row.id)!.roles.push(row.role as Role)
  }
  for (const row of former) members.set(row.id, { ...row, roles: [], active: false })
  return [...members.values()].map(member => ({ ...member, roles: member.roles.sort() })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

export async function assignStaffRoles(actor: Actor, targetId: string, roles: Role[]) {
  await requireAdmin(actor, 'STAFF_ROLES')
  if (!validStaffRoles(roles)) throw createError({ statusCode: 400, statusMessage: 'Invalid staff roles' })
  const assigned = await useDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(41422029)`)
    const [target] = await tx.select({ id: user.id }).from(user).where(eq(user.id, targetId)).for('update')
    if (!target) throw createError({ statusCode: 404, statusMessage: 'Not found' })
    const current = await tx.select({ role: userRole.role }).from(userRole).where(eq(userRole.userId, targetId))
    if (current.some(row => row.role === 'PATIENT') || !current.length) throw createError({ statusCode: 409, statusMessage: 'Not an active staff account' })
    if (current.some(row => row.role === 'ADMIN') && !roles.includes('ADMIN')) {
      const [other] = await tx.select({ id: userRole.userId }).from(userRole).innerJoin(account, and(eq(account.userId, userRole.userId), eq(account.providerId, 'credential'), sql`${account.password} IS NOT NULL`)).where(and(eq(userRole.role, 'ADMIN'), sql`${userRole.userId} <> ${targetId}`)).limit(1)
      if (!other) throw createError({ statusCode: 409, statusMessage: 'Last administrator' })
    }
    await tx.delete(userRole).where(eq(userRole.userId, targetId))
    await tx.insert(userRole).values(roles.map(role => ({ userId: targetId, role })))
    await tx.delete(session).where(eq(session.userId, targetId))
    await tx.insert(auditEvent).values({ id: crypto.randomUUID(), action: 'STAFF_ROLES', outcome: 'ALLOWED', actorId: actor.id, subjectId: targetId })
    return roles
  })
  return { id: targetId, roles: assigned }
}

export async function deactivateStaff(actor: Actor, targetId: string) {
  await requireAdmin(actor, 'STAFF_DEACTIVATE')
  await useDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(41422029)`)
    const [target] = await tx.select({ id: user.id }).from(user).where(eq(user.id, targetId)).for('update')
    if (!target) throw createError({ statusCode: 404, statusMessage: 'Not found' })
    const current = await tx.select({ role: userRole.role }).from(userRole).where(eq(userRole.userId, targetId))
    if (!current.length || current.some(row => row.role === 'PATIENT')) throw createError({ statusCode: 409, statusMessage: 'Not an active staff account' })
    const [credential] = await tx.select({ id: account.id }).from(account).where(and(eq(account.userId, targetId), eq(account.providerId, 'credential'), sql`${account.password} IS NOT NULL`)).limit(1)
    if (!credential) throw createError({ statusCode: 409, statusMessage: 'Pending activation' })
    if (current.some(row => row.role === 'ADMIN')) {
      const [other] = await tx.select({ id: userRole.userId }).from(userRole).innerJoin(account, and(eq(account.userId, userRole.userId), eq(account.providerId, 'credential'), sql`${account.password} IS NOT NULL`)).where(and(eq(userRole.role, 'ADMIN'), sql`${userRole.userId} <> ${targetId}`)).limit(1)
      if (!other) throw createError({ statusCode: 409, statusMessage: 'Last administrator' })
    }
    await tx.delete(session).where(eq(session.userId, targetId))
    await tx.update(setupToken).set({ usedAt: new Date() }).where(and(eq(setupToken.userId, targetId), sql`${setupToken.usedAt} IS NULL`))
    await tx.delete(userRole).where(eq(userRole.userId, targetId))
    await tx.insert(auditEvent).values({ id: crypto.randomUUID(), action: 'STAFF_DEACTIVATE', outcome: 'ALLOWED', actorId: actor.id, subjectId: targetId })
  })
  return { id: targetId, active: false }
}

export async function reactivateStaff(actor: Actor, targetId: string, roles: Role[]) {
  await requireAdmin(actor, 'STAFF_REACTIVATE')
  if (!validStaffRoles(roles)) throw createError({ statusCode: 400, statusMessage: 'Invalid staff roles' })
  return useDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(41422029)`)
    const [target] = await tx.select({ id: user.id }).from(user).where(eq(user.id, targetId)).for('update')
    if (!target) throw createError({ statusCode: 404, statusMessage: 'Not found' })
    const current = await tx.select({ role: userRole.role }).from(userRole).where(eq(userRole.userId, targetId))
    const [credential] = await tx.select({ id: account.id }).from(account).where(and(eq(account.userId, targetId), eq(account.providerId, 'credential'), sql`${account.password} IS NOT NULL`)).limit(1)
    const [deactivation] = await tx.select({ id: auditEvent.id }).from(auditEvent).where(and(eq(auditEvent.action, 'STAFF_DEACTIVATE'), eq(auditEvent.outcome, 'ALLOWED'), eq(auditEvent.subjectId, targetId))).limit(1)
    if (current.length || !credential || !deactivation) throw createError({ statusCode: 409, statusMessage: 'Not a deactivated credentialed staff account' })
    await tx.delete(session).where(eq(session.userId, targetId))
    await tx.update(setupToken).set({ usedAt: new Date() }).where(and(eq(setupToken.userId, targetId), sql`${setupToken.usedAt} IS NULL`))
    await tx.insert(userRole).values(roles.map(role => ({ userId: targetId, role })))
    await tx.insert(auditEvent).values({ id: crypto.randomUUID(), action: 'STAFF_REACTIVATE', outcome: 'ALLOWED', actorId: actor.id, subjectId: targetId })
    return { id: targetId, roles, active: true }
  })
}
