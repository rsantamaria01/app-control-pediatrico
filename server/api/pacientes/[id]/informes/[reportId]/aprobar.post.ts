import { createError, defineEventHandler, getRouterParam } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../../../../services/access'
import { approveFamilyReport, getDoctorDraft } from '../../../../../services/reports'

export default defineEventHandler(async (event) => {
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const reportId = z.uuid().parse(getRouterParam(event, 'reportId'))
  const actor = await requireCapability(event, 'CLINICAL_WRITE', id)
  const draft = await getDoctorDraft(actor, id, reportId)
  if (draft.patientId !== id) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return approveFamilyReport(actor, reportId)
})
