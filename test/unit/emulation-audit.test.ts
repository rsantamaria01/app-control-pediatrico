import { beforeEach, expect, it, vi } from 'vitest'

const values = vi.fn(async (_entry: unknown) => {})
vi.mock('nitropack/runtime', () => ({ defineNitroPlugin: (plugin: unknown) => plugin }))
vi.mock('../../server/utils/db', () => ({ useDb: () => ({ insert: () => ({ values }) }) }))

beforeEach(() => values.mockClear())

it.each([[403, 'DENIED'], [200, 'ALLOWED']] as const)('records HTTP %i as %s for an emulated write', async (statusCode, outcome) => {
  let beforeResponse: ((event: unknown) => Promise<void>) | undefined
  const { default: plugin } = await import('../../server/plugins/emulation-audit')
  plugin({ hooks: { hook: (_name: string, callback: typeof beforeResponse) => {
    beforeResponse = callback
  } } } as never)
  expect(beforeResponse).toBeDefined()
  await beforeResponse!({ context: { emulatedWrite: { adminId: 'admin', role: 'DOCTOR', userId: 'doctor', method: 'POST', path: '/api/example' } }, node: { res: { statusCode } }, res: { statusCode } })
  expect(values).toHaveBeenCalledWith(expect.objectContaining({ outcome, actorId: 'admin', emulatedRole: 'DOCTOR' }))
})
