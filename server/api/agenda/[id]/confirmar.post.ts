import { defineEventHandler, getRouterParam } from 'h3'
import { requireCapability } from '../../../services/access'
import { confirmAppointment } from '../../../services/appointments'

export default defineEventHandler(async event => confirmAppointment(await requireCapability(event, 'SCHEDULE'), getRouterParam(event, 'id')!))
