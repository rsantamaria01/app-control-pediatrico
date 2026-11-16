import { afterEach, expect, it, vi } from 'vitest'
import { sendMetaTemplate } from '../../server/services/providers/meta'
import { sendTwilioTemplate } from '../../server/services/providers/twilio'

const event = { kind: 'CHECKUP_DUE' as const, subjectId: 'checkup-1' }

afterEach(() => vi.unstubAllGlobals())

it('sends a Meta approved template with bearer auth and no clinical data', async () => {
  const send = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.accepted' }] }), { status: 200 }))
  vi.stubGlobal('fetch', send)
  expect(await sendMetaTemplate({ provider: 'META', sender: '123456789', template: 'control_due', language: 'es', secret: 'token-private' }, '+593991234567', event)).toBe('ACCEPTED')
  expect(send).toHaveBeenCalledTimes(1)
  const [url, options] = send.mock.calls[0]!
  expect(String(url)).toContain('/123456789/messages')
  expect(options.headers.Authorization).toBe('Bearer token-private')
  expect(JSON.parse(options.body)).toMatchObject({ messaging_product: 'whatsapp', to: '593991234567', type: 'template', template: { name: 'control_due', language: { code: 'es' } } })
  expect(options.body).not.toContain('checkup-1')
})

it('sends Twilio ContentSid only by authenticated form without free-form Body', async () => {
  const send = vi.fn(async () => new Response(JSON.stringify({ sid: 'SMaccepted', status: 'queued' }), { status: 201 }))
  vi.stubGlobal('fetch', send)
  expect(await sendTwilioTemplate({ provider: 'TWILIO', sender: '+15551234567', accountSid: `AC${'a'.repeat(32)}`, template: `HX${'b'.repeat(32)}`, secret: 'token-private' }, '+593991234567', event)).toBe('ACCEPTED')
  expect(send).toHaveBeenCalledTimes(1)
  const [url, options] = send.mock.calls[0]!
  expect(String(url)).toContain('/Messages.json')
  expect(options.headers.Authorization).toBe(`Basic ${Buffer.from(`AC${'a'.repeat(32)}:token-private`).toString('base64')}`)
  const body = new URLSearchParams(options.body)
  expect(Object.fromEntries(body)).toMatchObject({ To: 'whatsapp:+593991234567', From: 'whatsapp:+15551234567', ContentSid: `HX${'b'.repeat(32)}` })
  expect(body.has('Body')).toBe(false)
  expect(body.toString()).not.toContain('checkup-1')
})

it('treats ambiguous or rejected responses as failure rather than accepted delivery', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
  expect(await sendMetaTemplate({ provider: 'META', sender: '123456789', template: 'control_due', language: 'es', secret: 'token-private' }, '+593991234567', event)).toBe('FAILED')
  expect(await sendTwilioTemplate({ provider: 'TWILIO', sender: '+15551234567', accountSid: `AC${'a'.repeat(32)}`, template: `HX${'b'.repeat(32)}`, secret: 'token-private' }, '+593991234567', event)).toBe('FAILED')
})
