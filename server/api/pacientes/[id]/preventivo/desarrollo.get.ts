import { defineEventHandler, getRouterParam } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../../../services/access'
import { listDevelopment } from '../../../../services/development'

export default defineEventHandler(async (event) => {
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  return listDevelopment(await requireCapability(event, 'CLINICAL_READ', id), id)
})
