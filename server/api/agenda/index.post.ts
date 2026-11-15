import { defineEventHandler, readBody } from 'h3'
import { appointmentSchema, assistantAppointmentSchema } from '../../../shared/types/scheduling'
import { requireCapability } from '../../services/access'
import { scheduleAppointment } from '../../services/appointments'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'SCHEDULE')
  const body = await readBody(event)
  return scheduleAppointment(actor, (actor.roles.includes('DOCTOR') ? appointmentSchema : assistantAppointmentSchema).parse(body))
})
