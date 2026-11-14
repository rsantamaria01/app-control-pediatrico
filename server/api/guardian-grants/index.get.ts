import { defineEventHandler, getQuery } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../services/access'
import { listGrantCandidates } from '../../services/invitations'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'GUARDIAN_GRANT')
  const { q } = z.object({ q: z.string().max(100).default('') }).parse(getQuery(event))
  return listGrantCandidates(actor, q)
})
