import { defineEventHandler, getRouterParam } from 'h3'
import { requireCapability } from '../../../services/access'
import { attendAppointment } from '../../../services/appointments'

export default defineEventHandler(async event => attendAppointment(await requireCapability(event, 'SCHEDULE'), getRouterParam(event, 'id')!))
