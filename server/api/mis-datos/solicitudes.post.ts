import { createError, defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { resolveActor } from '../../services/access'
import { requestDataAction } from '../../services/data-requests'

export default defineEventHandler(async (event) => {
  const actor = await resolveActor(event)
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  const result = z.strictObject({ type: z.enum(['VIEW', 'EXPORT', 'DELETE']) }).safeParse(await readBody(event))
  if (!result.success) throw createError({ statusCode: 400, statusMessage: 'Invalid request type' })
  return requestDataAction(actor, result.data.type)
})
