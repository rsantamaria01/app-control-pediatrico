import { createError, defineEventHandler, getRouterParam } from 'h3'
import { catalogKinds, type CatalogKind } from '../../../shared/types/catalog'
import { requireCapability } from '../../services/access'
import { getCatalogView } from '../../services/catalog-import'

export default defineEventHandler(async (event) => {
  await requireCapability(event, 'CLINICAL_READ')
  const kind = getRouterParam(event, 'kind')?.toUpperCase() as CatalogKind
  if (!catalogKinds.includes(kind)) throw createError({ statusCode: 400, statusMessage: 'Invalid catalog kind' })
  return getCatalogView(kind)
})
