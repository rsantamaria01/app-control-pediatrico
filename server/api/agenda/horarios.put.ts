import { defineEventHandler, readBody } from 'h3'
import { availabilitySchema } from '../../../shared/types/scheduling'
import { requireCapability } from '../../services/access'
import { saveAvailability } from '../../services/availability'

export default defineEventHandler(async event => saveAvailability(await requireCapability(event, 'SCHEDULE'), availabilitySchema.parse(await readBody(event))))
