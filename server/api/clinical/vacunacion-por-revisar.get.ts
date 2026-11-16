import { defineEventHandler } from 'h3'
import { requireCapability } from '../../services/access'
import { listVaccinationReview } from '../../services/vaccination'

export default defineEventHandler(async event => listVaccinationReview(await requireCapability(event, 'CLINICAL_READ')))
