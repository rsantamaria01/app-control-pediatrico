import { defineEventHandler } from 'h3'
import { requireCapability } from '../../services/access'
import { listShareableChildren } from '../../services/invitations'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'PORTAL_READ')
  return listShareableChildren(actor)
})
