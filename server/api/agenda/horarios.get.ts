import { defineEventHandler } from 'h3'
import { requireCapability } from '../../services/access'
import { getAvailabilitySettings } from '../../services/availability'

export default defineEventHandler(async event => getAvailabilitySettings(await requireCapability(event, 'SCHEDULE')))
