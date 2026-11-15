import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireCapability } from '../../../services/access'
import { listPendingContacts } from '../../../services/patients'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400 })
  const actor = await requireCapability(event, 'CLINICAL_READ', id)
  return listPendingContacts(actor, id)
})
