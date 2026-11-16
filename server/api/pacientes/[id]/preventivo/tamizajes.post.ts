import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { screeningResultSchema } from '../../../../../shared/types/preventive'
import { requireCapability } from '../../../../services/access'
import { recordScreening } from '../../../../services/development'

export default defineEventHandler(async (event) => {
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const actor = await requireCapability(event, 'CLINICAL_WRITE', id)
  const body = z.strictObject({ instrument: z.string().trim().min(1).max(200), ...screeningResultSchema.shape }).parse(await readBody(event))
  return recordScreening(actor, id, body.instrument, body)
})
