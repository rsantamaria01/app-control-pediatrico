import { defineEventHandler, getRouterParam } from 'h3'
import { requireCapability } from '../../services/access'
import { cancelAppointment } from '../../services/appointments'

export default defineEventHandler(async event => cancelAppointment(await requireCapability(event, 'SCHEDULE'), getRouterParam(event, 'id')!))
