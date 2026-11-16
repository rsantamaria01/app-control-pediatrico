import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { emailProviderHealth, sendBookingCode, sendLink } from '../../server/services/email'

const { resolve, send, createTransport, health } = vi.hoisted(() => ({
  resolve: vi.fn(), send: vi.fn(), createTransport: vi.fn(), health: { state: undefined as 'CONFIGURED' | 'FAILING' | undefined }
}))
vi.mock('../../server/services/smtp-settings', () => ({ resolveSmtpTransport: resolve }))
vi.mock('nodemailer', () => ({ default: { createTransport } }))
vi.mock('../../server/utils/db', () => ({ useDb: () => ({
  insert: () => ({ values: (row: { state: 'CONFIGURED' | 'FAILING' }) => ({ onConflictDoUpdate: async ({ set }: { set: { state: 'CONFIGURED' | 'FAILING' } }) => { health.state = health.state === undefined ? row.state : set.state } }) }),
  select: () => ({ from: () => ({ where: async () => health.state === undefined ? [] : [{ state: health.state }] }) })
}) }))

const config = { host: 'smtp.example.test', port: 587, security: 'STARTTLS', username: 'mailer', password: 'private-password', fromName: 'Clínica', fromAddress: 'clinic@example.test' }

beforeEach(() => {
  vi.clearAllMocks()
  resolve.mockResolvedValue(config)
  createTransport.mockReturnValue({ sendMail: send })
  send.mockResolvedValue({ accepted: ['family@example.test'], rejected: [] })
  health.state = undefined
})

afterEach(() => vi.restoreAllMocks())

it.each([
  ['STARTTLS', { secure: false, requireTLS: true, ignoreTLS: false }],
  ['TLS', { secure: true, requireTLS: false, ignoreTLS: false }],
  ['NONE', { secure: false, requireTLS: false, ignoreTLS: true }]
] as const)('uses %s security for booking mail', async (security, options) => {
  resolve.mockResolvedValue({ ...config, security, username: security === 'NONE' ? '' : config.username, password: security === 'NONE' ? '' : config.password })
  await sendBookingCode('family@example.test', '123456')
  expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: config.host, port: 587, auth: security === 'NONE' ? undefined : { user: 'mailer', pass: 'private-password' }, ...options }))
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: { name: 'Clínica', address: 'clinic@example.test' }, to: 'family@example.test', text: expect.stringContaining('123456') }))
})

it('uses resolved configuration for invitation and recovery links', async () => {
  await sendLink('family@example.test', 'https://clinic.example.test/invitacion/token')
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('https://clinic.example.test/invitacion/token') }))
})

it('refuses a missing configuration without creating transport', async () => {
  resolve.mockResolvedValue(null)
  await expect(sendLink('family@example.test', 'private-link')).rejects.toThrow('Email transport unavailable')
  expect(createTransport).not.toHaveBeenCalled()
  expect(await emailProviderHealth()).toBe('NOT_CONFIGURED')
})

it('fails closed on a missing decryption key without leaking the secret', async () => {
  resolve.mockRejectedValue(new Error('SMTP configuration key unavailable private-password'))
  await expect(sendLink('family@example.test', 'private-link')).rejects.toThrow('Email transport unavailable')
  expect(createTransport).not.toHaveBeenCalled()
  expect(await emailProviderHealth()).toBe('NOT_CONFIGURED')
})

it('does not report delivery when the provider rejects every recipient', async () => {
  send.mockResolvedValue({ accepted: [], rejected: ['family@example.test'] })
  await expect(sendBookingCode('family@example.test', '123456')).rejects.toThrow('Email delivery failed')
  expect(await emailProviderHealth()).toBe('FAILING')
})

it('reports transport errors without exposing provider messages or credentials', async () => {
  send.mockRejectedValue(new Error('private-password private-link'))
  const failure = await sendLink('family@example.test', 'private-link').catch(error => error as Error)
  expect(failure.message).toBe('Email delivery failed')
  expect(JSON.stringify(failure)).not.toContain('private-password')
  expect(JSON.stringify(failure)).not.toContain('private-link')
  expect(await emailProviderHealth()).toBe('FAILING')
})

it('restores provider health after a later successful send', async () => {
  send.mockRejectedValueOnce(new Error('private-password'))
  await expect(sendBookingCode('family@example.test', '123456')).rejects.toThrow(/^Email delivery failed$/)
  expect(await emailProviderHealth()).toBe('FAILING')
  await sendBookingCode('family@example.test', '654321')
  expect(await emailProviderHealth()).toBe('CONFIGURED')
})
