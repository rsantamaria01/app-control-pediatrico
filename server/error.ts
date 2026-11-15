import { defineNitroErrorHandler } from 'nitropack/runtime'
import { send, setResponseHeaders, setResponseStatus } from 'h3'

export default defineNitroErrorHandler(async (error, event, { defaultHandler }) => {
  if (!event.path.startsWith('/api/')) return
  const response = await defaultHandler(error, event, { json: true })
  setResponseHeaders(event, { ...response.headers, 'cache-control': 'private, no-store, max-age=0' })
  setResponseStatus(event, response.status, response.statusText)
  return send(event, typeof response.body === 'string' ? response.body : JSON.stringify(response.body, null, 2))
})
