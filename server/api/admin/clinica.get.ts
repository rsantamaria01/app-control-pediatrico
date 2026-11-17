import { defineEventHandler } from 'h3'
import { requireCapability } from '../../services/access'
import { getClinicSettings } from '../../services/clinic-settings'

export default defineEventHandler(async (event) => {
  await requireCapability(event, 'ADMINISTER')
  return getClinicSettings()
})
