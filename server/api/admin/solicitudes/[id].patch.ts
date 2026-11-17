import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../../services/access'
import { handleDataRequest } from '../../../services/data-requests'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'ADMINISTER')
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid request' })
  const input = z.strictObject({ status: z.enum(['UNDER_REVIEW', 'CLOSED']) }).safeParse(await readBody(event))
  if (!input.success) throw createError({ statusCode: 400, statusMessage: 'Invalid status' })
  return handleDataRequest(actor, id, input.data.status)
})
