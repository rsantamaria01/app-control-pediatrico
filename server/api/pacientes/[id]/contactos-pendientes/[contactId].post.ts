import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../../../services/access'
import { retryPendingContact } from '../../../../services/patients'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const contactId = getRouterParam(event, 'contactId')
  if (!id || !contactId) throw createError({ statusCode: 400 })
  const actor = await requireCapability(event, 'CLINICAL_WRITE', id)
  const confirmation = z.strictObject({ confirmedGuardianId: z.uuid().optional(), phone: z.string().optional(), email: z.union([z.email(), z.literal('')]).optional(), name: z.string().trim().min(2).max(160).optional(), relationship: z.string().trim().min(2).max(80).optional(), proof: z.string().trim().min(8).max(500).optional() }).parse(await readBody(event))
  return retryPendingContact(actor, id, contactId, confirmation)
})
