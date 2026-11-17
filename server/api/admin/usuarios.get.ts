import { defineEventHandler } from 'h3'
import { requireCapability } from '../../services/access'
import { listStaff } from '../../services/admin'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'ADMINISTER')
  return listStaff(actor)
})
