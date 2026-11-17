import { defineEventHandler, setResponseHeader } from 'h3'
import { getPublicClinicBrand } from '../../services/clinic-settings'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store, max-age=0')
  return getPublicClinicBrand()
})
