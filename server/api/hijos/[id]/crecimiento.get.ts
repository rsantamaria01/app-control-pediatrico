import { defineEventHandler, getRouterParam } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../../services/access'
import { getFamilyGrowth } from '../../../services/growth-charts'

export default defineEventHandler(async (event) => {
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const actor = await requireCapability(event, 'PORTAL_READ')
  return getFamilyGrowth(actor, id)
})
