import { defineEventHandler } from 'h3'
import { requireCapability } from '../../../services/access'
import { pendingBookingCount } from '../../../services/booking'

export default defineEventHandler(async event => ({ count: await pendingBookingCount(await requireCapability(event, 'SCHEDULE')) }))
