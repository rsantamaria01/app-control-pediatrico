import { and, count, desc, eq } from 'drizzle-orm'
import { createError } from 'nuxt/server'
import type { Actor } from '../../shared/types/access'
import type { DataRequest, DataRequestPage } from '../../shared/types/admin'
import { auditEvent, dataRequest, userRole } from '../db/schema'
import { useDb } from '../utils/db'
import { recordAudit } from './audit'

export async function requestDataAction(actor: Actor, type: 'VIEW' | 'EXPORT' | 'DELETE'): Promise<DataRequest> {
  if (!actor?.id) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  if (!['VIEW', 'EXPORT', 'DELETE'].includes(type)) throw createError({ statusCode: 400, statusMessage: 'Invalid request type' })
  const id = crypto.randomUUID()
  const result = await useDb().transaction(async (tx) => {
    const assigned = await tx.select({ role: userRole.role }).from(userRole).where(eq(userRole.userId, actor.id))
    if (!assigned.length) throw createError({ statusCode: 403, statusMessage: 'Access denied' })
    const [row] = await tx.insert(dataRequest).values({ id, requesterId: actor.id, type }).returning()
    await tx.insert(auditEvent).values({ id: crypto.randomUUID(), actorId: actor.id, action: 'DATA_REQUEST', subjectId: id, outcome: 'ALLOWED' })
    return row!
  })
  return result as DataRequest
}

export async function listDataRequests(actor: Actor): Promise<DataRequest[]> {
  if (!actor?.id) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  const rows = await useDb().select().from(dataRequest).where(eq(dataRequest.requesterId, actor.id)).orderBy(desc(dataRequest.createdAt), desc(dataRequest.id)).limit(100)
  return rows as DataRequest[]
}

export async function listAllDataRequests(actor: Actor, page = 1): Promise<DataRequestPage> {
  if (!actor?.roles.includes('ADMIN')) {
    throw createError({ statusCode: 403, statusMessage: 'Access denied' })
  }
  const pageSize = 100
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger((page - 1) * pageSize)) throw createError({ statusCode: 400, statusMessage: 'Invalid page' })
  const db = useDb()
  const [total] = await db.select({ count: count() }).from(dataRequest)
  const items = await db.select().from(dataRequest).orderBy(desc(dataRequest.createdAt), desc(dataRequest.id)).limit(pageSize).offset((page - 1) * pageSize)
  return { items: items as DataRequest[], page, pageSize, total: total!.count }
}

export async function handleDataRequest(actor: Actor, id: string, status: 'UNDER_REVIEW' | 'CLOSED'): Promise<DataRequest> {
  if (!actor.roles.includes('ADMIN')) {
    await recordAudit('DATA_REQUEST_HANDLE', 'DENIED', actor.id, id)
    throw createError({ statusCode: 403, statusMessage: 'Access denied' })
  }
  if (!['UNDER_REVIEW', 'CLOSED'].includes(status)) throw createError({ statusCode: 400, statusMessage: 'Invalid status' })
  if (status === 'CLOSED') throw createError({ statusCode: 409, statusMessage: 'Resolution requires reviewed legal workflow' })
  return useDb().transaction(async (tx) => {
    const [row] = await tx.update(dataRequest).set({ status, handledBy: actor.id, updatedAt: new Date() }).where(and(eq(dataRequest.id, id), eq(dataRequest.status, 'QUEUED'))).returning()
    if (!row) throw createError({ statusCode: 409, statusMessage: 'Request not in expected state' })
    await tx.insert(auditEvent).values({ id: crypto.randomUUID(), action: 'DATA_REQUEST_HANDLE', outcome: 'ALLOWED', actorId: actor.id, subjectId: id })
    return row as DataRequest
  })
}
