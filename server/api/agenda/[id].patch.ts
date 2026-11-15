import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { appointmentMoveSchema } from '../../../shared/types/scheduling'
import { requireCapability } from '../../services/access'
import { rescheduleAppointment } from '../../services/appointments'

export default defineEventHandler(async event => rescheduleAppointment(await requireCapability(event, 'SCHEDULE'), getRouterParam(event, 'id')!, appointmentMoveSchema.parse(await readBody(event))))
