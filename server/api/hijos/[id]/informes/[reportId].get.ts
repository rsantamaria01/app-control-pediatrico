import { defineEventHandler, getRouterParam } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../../../services/access'
import { getApprovedReport } from '../../../../services/reports'

export default defineEventHandler(async (event) => {
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const reportId = z.uuid().parse(getRouterParam(event, 'reportId'))
  const actor = await requireCapability(event, 'PORTAL_READ', id)
  return getApprovedReport(actor, id, reportId)
})
