import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../../services/access'
import { updatePatientIdentity } from '../../../services/patients'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400 })
  const actor = await requireCapability(event, 'CLINICAL_WRITE', id)
  const { nationalId } = z.strictObject({ nationalId: z.string() }).parse(await readBody(event))
  return updatePatientIdentity(actor, id, nationalId)
})
