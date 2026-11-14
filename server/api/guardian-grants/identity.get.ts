import { defineEventHandler, getQuery } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../services/access'
import { findGuardianIdentity } from '../../services/invitations'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'GUARDIAN_GRANT')
  const identity = z.strictObject({ email: z.email().optional(), phone: z.string().optional() }).refine(value => Boolean(value.email || value.phone)).parse(getQuery(event))
  return findGuardianIdentity(actor, identity)
})
