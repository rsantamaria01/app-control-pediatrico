import { defineEventHandler, getRouterParam } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../../services/access'
import { getShareableChild } from '../../../services/invitations'

export default defineEventHandler(async (event) => {
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const actor = await requireCapability(event, 'PORTAL_READ')
  return getShareableChild(actor, id)
})
