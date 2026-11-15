import { defineEventHandler, getRouterParam, setResponseHeader } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../../../../services/access'
import { renderFamilyReport } from '../../../../../services/reports'

export default defineEventHandler(async (event) => {
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const reportId = z.uuid().parse(getRouterParam(event, 'reportId'))
  const actor = await requireCapability(event, 'PORTAL_READ', id)
  const pdf = await renderFamilyReport(actor, id, reportId)
  setResponseHeader(event, 'Content-Type', 'application/pdf')
  setResponseHeader(event, 'Content-Disposition', 'attachment; filename="informe-familiar.pdf"')
  setResponseHeader(event, 'Cache-Control', 'private, no-store, max-age=0')
  return pdf
})
