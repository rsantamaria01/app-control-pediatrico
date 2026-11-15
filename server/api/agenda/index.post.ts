import { defineEventHandler, readBody } from 'h3'
import { appointmentSchema } from '../../../shared/types/scheduling'
import { requireCapability } from '../../services/access'
import { scheduleAppointment } from '../../services/appointments'

export default defineEventHandler(async event => scheduleAppointment(await requireCapability(event, 'SCHEDULE'), appointmentSchema.parse(await readBody(event))))
