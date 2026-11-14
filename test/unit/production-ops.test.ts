import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8')
const compose = readFileSync(new URL('../../compose.yaml', import.meta.url), 'utf8')
const scripts = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).scripts

vi.mock('nitropack/runtime', () => ({ defineNitroPlugin: (plugin: unknown) => plugin }))
vi.mock('../../server/services/recovery', () => ({
  acquireRecoveryWorker: vi.fn(),
  reconcileRecoveryJobs: vi.fn(),
  processRecoveryJobs: vi.fn()
}))

const { default: recoveryPlugin } = await import('../../server/plugins/recovery-worker')
const { acquireRecoveryWorker, reconcileRecoveryJobs, processRecoveryJobs } = await import('../../server/services/recovery')

describe('production operations', () => {
  it('ships migration and bootstrap inputs in an ops image without adding them to the app image', () => {
    expect(dockerfile).toMatch(/FROM node:24-alpine AS ops/)
    const ops = dockerfile.split('FROM node:24-alpine AS ops')[1]?.split('FROM node:24-alpine AS app')[0]
    const app = dockerfile.split('FROM node:24-alpine AS app')[1]
    for (const path of ['node_modules', 'drizzle.config.ts', 'server/db/schema.ts', 'server/db/migrations', 'server/services/credentials.ts', 'scripts/bootstrap-admin.ts']) expect(ops).toContain(path)
    expect(ops).toContain('ENTRYPOINT ["pnpm", "run"]')
    expect(ops).toContain('CMD ["db:migrate"]')
    expect(app).toContain('/app/.output')
    expect(app).not.toContain('node_modules')
    expect(scripts['bootstrap-admin']).toBeTruthy()
  })

  it('requires the migration to complete successfully before starting the app', () => {
    const app = compose.split('  app:')[1]?.split('\n  ops:')[0]
    const ops = compose.split('\n  ops:')[1]?.split('\n  db:')[0]
    expect(app).toMatch(/ops:\s*\{ condition: service_completed_successfully \}/)
    expect(ops).toContain('target: ops')
    expect(ops).toContain('profiles: ["full"]')
    expect(ops).toMatch(/db:\s*\{ condition: service_healthy \}/)
  })
})

describe('recovery worker before migrations', () => {
  it('keeps ordinary failures on the regular retry schedule', async () => {
    vi.useFakeTimers()
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(acquireRecoveryWorker).mockResolvedValue({ isActive: vi.fn().mockResolvedValue(true), release: vi.fn() })
    vi.mocked(reconcileRecoveryJobs).mockRejectedValueOnce(new Error('connection reset')).mockResolvedValue(0)
    vi.mocked(processRecoveryJobs).mockResolvedValue(0)
    const hooks = { hook: vi.fn() }
    try {
      recoveryPlugin({ hooks } as never)
      await vi.advanceTimersByTimeAsync(500)
      expect(reconcileRecoveryJobs).toHaveBeenCalledTimes(2)
      expect(processRecoveryJobs).toHaveBeenCalled()
      expect(logger.mock.calls[0]?.[0]).toContain('WorkerError')
    } finally {
      await hooks.hook.mock.calls[0]?.[1]()
      logger.mockRestore()
      vi.useRealTimers()
      vi.clearAllMocks()
    }
  })

  it('does not repeat missing-schema logs during consecutive retries', async () => {
    vi.useFakeTimers()
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(acquireRecoveryWorker).mockResolvedValue({ isActive: vi.fn().mockResolvedValue(true), release: vi.fn() })
    vi.mocked(reconcileRecoveryJobs).mockRejectedValue(Object.assign(new Error('missing table'), { code: '42P01' }))
    const hooks = { hook: vi.fn() }
    try {
      recoveryPlugin({ hooks } as never)
      await vi.advanceTimersByTimeAsync(11250)
      expect(reconcileRecoveryJobs).toHaveBeenCalledTimes(3)
      expect(logger).toHaveBeenCalledTimes(1)
      expect(logger.mock.calls[0]?.[0]).toContain('schema not migrated')
    } finally {
      await hooks.hook.mock.calls[0]?.[1]()
      logger.mockRestore()
      vi.useRealTimers()
      vi.clearAllMocks()
    }
  })

  it('reports missing schema once, backs off and resumes processing after migration', async () => {
    vi.useFakeTimers()
    const error = Object.assign(new Error('relation "recovery_job" does not exist'), { code: '42P01' })
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
    const active = vi.fn().mockResolvedValue(true)
    vi.mocked(acquireRecoveryWorker).mockResolvedValue({ isActive: active, release: vi.fn() })
    vi.mocked(reconcileRecoveryJobs).mockRejectedValueOnce(Object.assign(new Error('query failed'), { cause: error })).mockResolvedValue(0)
    vi.mocked(processRecoveryJobs).mockResolvedValue(0)
    const hooks = { hook: vi.fn() }
    try {
      recoveryPlugin({ hooks } as never)
      await vi.advanceTimersByTimeAsync(1000)
      expect(logger).toHaveBeenCalledTimes(1)
      expect(logger.mock.calls[0]?.[0]).toContain('schema not migrated')
      expect(reconcileRecoveryJobs).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(4000)
      expect(reconcileRecoveryJobs).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(250)
      expect(reconcileRecoveryJobs).toHaveBeenCalledTimes(2)
      expect(processRecoveryJobs).toHaveBeenCalled()
      expect(logger).toHaveBeenCalledTimes(1)
    } finally {
      await hooks.hook.mock.calls[0]?.[1]()
      logger.mockRestore()
      vi.useRealTimers()
      vi.clearAllMocks()
    }
  })
})
