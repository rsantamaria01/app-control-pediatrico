import { defineEventHandler, getQuery, getRouterParam, setResponseHeader } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../../../services/access'
import { renderDoctorReport } from '../../../../services/reports'

export default defineEventHandler(async (event) => {
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const actor = await requireCapability(event, 'CLINICAL_READ', id)
  const { includePrivateNotes } = z.strictObject({ includePrivateNotes: z.enum(['true']).optional() }).parse(getQuery(event))
  const pdf = await renderDoctorReport(actor, id, includePrivateNotes === 'true')
  setResponseHeader(event, 'Content-Type', 'application/pdf')
  setResponseHeader(event, 'Content-Disposition', 'attachment; filename="informe-medico.pdf"')
  setResponseHeader(event, 'Cache-Control', 'private, no-store, max-age=0')
  return pdf
})
