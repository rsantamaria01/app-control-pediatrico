import { defineEventHandler, getRouterParam } from 'h3'
import { z } from 'zod'
import { requireCapability } from '../../../../services/access'
import { listVaccines } from '../../../../services/vaccination'

export default defineEventHandler(async (event) => {
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  return listVaccines(await requireCapability(event, 'CLINICAL_READ', id), id)
})
