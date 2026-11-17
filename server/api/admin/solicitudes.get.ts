import { createError, defineEventHandler, getQuery } from 'h3'
import { requireCapability } from '../../services/access'
import { listAllDataRequests } from '../../services/data-requests'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'ADMINISTER')
  const { page: rawPage } = getQuery(event)
  const page = rawPage === undefined ? 1 : Number(rawPage)
  if (!Number.isSafeInteger(page) || page < 1) throw createError({ statusCode: 400, statusMessage: 'Invalid page' })
  return listAllDataRequests(actor, page)
})
