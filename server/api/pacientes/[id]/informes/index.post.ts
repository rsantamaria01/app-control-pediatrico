import { defineEventHandler, getRouterParam } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../../../services/access'
import { previewFamilyReport } from '../../../../services/reports'

export default defineEventHandler(async (event) => {
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const actor = await requireCapability(event, 'CLINICAL_WRITE', id)
  return previewFamilyReport(actor, id)
})
