import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { checkupInputSchema } from '../../../../../shared/types/preventive'
import { requireCapability } from '../../../../services/access'
import { recordCheckup } from '../../../../services/checkups'

export default defineEventHandler(async (event) => {
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const actor = await requireCapability(event, 'CLINICAL_WRITE', id)
  return recordCheckup(actor, id, checkupInputSchema.parse(await readBody(event)))
})
