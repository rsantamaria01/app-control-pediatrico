import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireCapability } from '../../../../services/access'
import { deactivateStaff } from '../../../../services/admin'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'ADMINISTER')
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid user' })
  return deactivateStaff(actor, id)
})
