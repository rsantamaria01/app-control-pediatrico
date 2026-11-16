import { defineEventHandler, getRouterParam } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../../../services/access'
import { nextCheckups } from '../../../../services/checkups'

export default defineEventHandler(async (event) => {
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  await requireCapability(event, 'CLINICAL_READ', id)
  return nextCheckups(id)
})
