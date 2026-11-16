import { defineEventHandler } from 'h3'
import { requireCapability } from '../../../services/access'
import { listBookingRequests } from '../../../services/booking'

export default defineEventHandler(async event => listBookingRequests(await requireCapability(event, 'SCHEDULE')))
