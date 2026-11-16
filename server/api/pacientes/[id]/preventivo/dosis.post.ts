import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { doseInputSchema } from '../../../../../shared/types/preventive'
import { requireCapability } from '../../../../services/access'
import { recordDose } from '../../../../services/vaccination'

export default defineEventHandler(async (event) => {
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const actor = await requireCapability(event, 'CLINICAL_WRITE', id)
  return recordDose(actor, id, doseInputSchema.parse(await readBody(event)))
})
