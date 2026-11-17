import { createError, defineEventHandler, getQuery } from 'h3'
import { requireCapability } from '../../services/access'
import { listAudit } from '../../services/admin'
import type { AuditFilter } from '../../../shared/types/admin'

export function auditFilter(query: Record<string, unknown>): AuditFilter {
  const page = query.page === undefined ? 1 : Number(query.page)
  const pageSize = query.pageSize === undefined ? 25 : Number(query.pageSize)
  const action = typeof query.action === 'string' && query.action.length <= 100 ? query.action : undefined
  const actorId = typeof query.actorId === 'string' && query.actorId.length <= 100 ? query.actorId : undefined
  const outcome = query.outcome === 'ALLOWED' || query.outcome === 'DENIED' ? query.outcome : undefined
  const from = typeof query.from === 'string' ? new Date(query.from) : undefined
  const to = typeof query.to === 'string' ? new Date(query.to) : undefined
  if ((query.action !== undefined && !action) || (query.actorId !== undefined && !actorId) || (query.outcome !== undefined && !outcome) || (query.from !== undefined && !from) || (query.to !== undefined && !to)) throw createError({ statusCode: 400, statusMessage: 'Invalid audit filter' })
  return { page, pageSize, action, actorId, outcome, from, to }
}

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'AUDIT_READ')
  return listAudit(actor, auditFilter(getQuery(event)))
})
