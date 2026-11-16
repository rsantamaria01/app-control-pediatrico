import { defineEventHandler } from 'h3'
import { requireCapability } from '../../services/access'
import { listGrowthReview } from '../../services/growth-review'

export default defineEventHandler(async event => listGrowthReview(await requireCapability(event, 'CLINICAL_READ')))
