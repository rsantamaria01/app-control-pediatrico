import { defineEventHandler, getQuery } from 'h3'
import { requireCapability } from '../../services/access'
import { listPatients } from '../../services/patients'

export default defineEventHandler(async (event) => {
  const actor = await requireCapability(event, 'CLINICAL_READ')
  const { q } = getQuery(event)
  return listPatients(actor, typeof q === 'string' ? q : '')
})
