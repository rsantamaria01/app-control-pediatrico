import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../../../services/access'
import { assignStaffRoles } from '../../../../services/admin'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'ADMINISTER')
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid user' })
  const input = z.strictObject({ roles: z.array(z.enum(['ADMIN', 'DOCTOR', 'ASSISTANT'])).min(1) }).safeParse(await readBody(event))
  if (!input.success) throw createError({ statusCode: 400, statusMessage: 'Invalid roles' })
  return assignStaffRoles(actor, id, input.data.roles)
})
