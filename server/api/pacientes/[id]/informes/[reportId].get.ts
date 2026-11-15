import { defineEventHandler, getRouterParam } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../../../services/access'
import { getDoctorDraft } from '../../../../services/reports'

export default defineEventHandler(async (event) => {
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const reportId = z.uuid().parse(getRouterParam(event, 'reportId'))
  const actor = await requireCapability(event, 'CLINICAL_READ', id)
  return getDoctorDraft(actor, id, reportId)
})
