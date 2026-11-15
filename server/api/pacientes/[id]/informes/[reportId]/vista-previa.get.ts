import { defineEventHandler, getRouterParam, setResponseHeader } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../../../../services/access'
import { getDoctorPreviewPdf } from '../../../../../services/reports'

export default defineEventHandler(async (event) => {
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const reportId = z.uuid().parse(getRouterParam(event, 'reportId'))
  const actor = await requireCapability(event, 'CLINICAL_READ', id)
  const pdf = await getDoctorPreviewPdf(actor, id, reportId)
  setResponseHeader(event, 'Content-Type', 'application/pdf')
  setResponseHeader(event, 'Content-Disposition', 'inline; filename="vista-previa-familiar.pdf"')
  setResponseHeader(event, 'Cache-Control', 'private, no-store, max-age=0')
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  return pdf
})
