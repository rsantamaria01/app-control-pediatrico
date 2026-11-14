import { defineEventHandler, getQuery } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../services/access'
import { findGuardianIdentity } from '../../services/invitations'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'GUARDIAN_GRANT')
  const { email } = z.strictObject({ email: z.email() }).parse(getQuery(event))
  return findGuardianIdentity(actor, email)
})
