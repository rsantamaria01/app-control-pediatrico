import { defineEventHandler, getQuery, setResponseHeader } from 'h3'
import { requireCapability } from '../../services/access'
import { exportAuditCsv } from '../../services/admin'
import { auditFilter } from './auditoria.get'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'AUDIT_READ')
  const csv = await exportAuditCsv(actor, auditFilter(getQuery(event)))
  setResponseHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setResponseHeader(event, 'Content-Disposition', 'attachment; filename="auditoria.csv"')
  setResponseHeader(event, 'Cache-Control', 'private, no-store, max-age=0')
  return csv
})
