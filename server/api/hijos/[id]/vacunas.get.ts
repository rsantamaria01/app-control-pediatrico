import { defineEventHandler, getRouterParam } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../../services/access'
import { listAppliedDoses } from '../../../services/vaccination'

export default defineEventHandler(async (event) => {
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  return listAppliedDoses(await requireCapability(event, 'PORTAL_READ', id), id)
})
