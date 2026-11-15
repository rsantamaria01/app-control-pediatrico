import { defineEventHandler, getRouterParam } from 'h3'
import { requireCapability } from '../../services/access'
import { getAppointment } from '../../services/appointments'

export default defineEventHandler(async event => getAppointment(await requireCapability(event, 'SCHEDULE'), getRouterParam(event, 'id')!))
