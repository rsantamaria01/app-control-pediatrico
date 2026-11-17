import { defineEventHandler, readBody } from 'h3'
import { requireCapability } from '../../services/access'
import { updateClinicSettings } from '../../services/clinic-settings'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'ADMINISTER')
  return updateClinicSettings(actor, await readBody(event))
})
