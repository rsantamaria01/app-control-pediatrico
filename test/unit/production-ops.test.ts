import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'

const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8')
const compose = readFileSync(new URL('../../compose.yaml', import.meta.url), 'utf8')
const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
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
  it('runs an unconditional Docker ops and Compose smoke on pushes and PRs', () => {
    expect(ci).toMatch(/on:\s*\[push, pull_request\]/)
    expect(ci).toMatch(/runs-on: ubuntu-latest/)
    expect(ci).toMatch(/scripts\/ci-ops-smoke\.sh/)
    const script = new URL('../../scripts/ci-ops-smoke.sh', import.meta.url)
    const syntax = spawnSync('sh', ['-n', script.pathname], { encoding: 'utf8' })
    expect(syntax.status).toBe(0)
    const content = readFileSync(script, 'utf8')
    expect(content).toMatch(/docker build --target ops/)
    expect(content).toMatch(/--network none/)
    expect(content).toMatch(/--read-only/)
    expect(content).toMatch(/docker compose --env-file \/dev\/null --project-name "\$project" --profile full/)
    expect(content).toMatch(/compose up -d --build/)
    expect(content).toMatch(/compose ps -a -q ops/)
    expect(content).toMatch(/compose ps --status running -q app/)
    expect(content).toMatch(/\[ ! -e \.env \]/)
    expect(content).toMatch(/NUXT_APP_SECRET=%s/)
    expect(content).toMatch(/rm -f \.env/)
    expect(content).toMatch(/WHO_ALLOW_CLINICAL_IMPORT=true/)
    expect(content).toMatch(/ci-volume-check/)
    expect(content).toMatch(/bootstrap-admin/)
  })

  it('reports fixed smoke phases and failure codes without leaking captured command output', () => {
    const content = readFileSync(new URL('../../scripts/ci-ops-smoke.sh', import.meta.url), 'utf8')
    for (const phase of ['build', 'offline-migration', 'who-gate', 'compose-up', 'compose-verify', 'who-volume', 'bootstrap']) {
      expect(content).toContain(`phase=${phase}`)
    }
    for (const code of ['OFFLINE_UNEXPECTED_SUCCESS', 'OFFLINE_COREPACK', 'OFFLINE_PERMISSION', 'OFFLINE_DOWNLOAD']) {
      expect(content).toContain(code)
    }
    for (const code of ['OFFLINE_MODULE_NOT_FOUND', 'OFFLINE_READ_ONLY', 'OFFLINE_SYNTAX_ERROR', 'OFFLINE_CONNECTION_OTHER', 'OFFLINE_RUNTIME_OTHER']) expect(content).toContain(code)
    expect(content).not.toMatch(/\*'No config path provided'\*\|/)
    expect(content).not.toMatch(/\*"\/app\/"\*\|\*"'\.\/server\/"\*/)
    for (const code of ['OFFLINE_ENOENT_OPEN', 'OFFLINE_ENOENT_MKDIR', 'OFFLINE_ENOENT_STAT', 'OFFLINE_ENOENT_OTHER']) expect(content).toContain(code)
    expect(content).not.toMatch(/\*'drizzle\.config\.ts'\*\) fail OFFLINE_PATH_CONFIG/)
    for (const code of ['OFFLINE_DOCKER_ERROR', 'OFFLINE_DEPENDENCY_ERROR', 'OFFLINE_PATH_TMP', 'OFFLINE_PATH_OTHER', 'OFFLINE_DB_CONFIG_ERROR', 'OFFLINE_RUNTIME_TYPE_ERROR']) expect(content).toContain(code)
    expect(content).toMatch(/ops-smoke failed phase=%s code=%s/)
    expect(content).not.toMatch(/(?:printf|echo)\s+[^\n]*\$output/)
    expect(content).not.toMatch(/set -x/)
  })

  it('ships migration and bootstrap inputs in an ops image without adding them to the app image', () => {
    expect(dockerfile).toMatch(/FROM node:24-alpine AS ops/)
    const ops = dockerfile.split('FROM node:24-alpine AS ops')[1]?.split('FROM node:24-alpine AS app')[0]
    const app = dockerfile.split('FROM node:24-alpine AS app')[1]
    for (const path of ['node_modules', 'drizzle.config.ts', 'server/db/schema.ts', 'server/db/migrations', 'server/services/credentials.ts', 'scripts/bootstrap-admin.ts']) expect(ops).toContain(path)
    expect(ops).toContain('ENTRYPOINT ["node", "scripts/ops.mjs"]')
    expect(ops).toContain('CMD ["db:migrate"]')
    expect(app).toContain('/app/.output')
    expect(app).toContain('scripts/database-env.mjs')
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

  it('rejects WHO import without explicit rights before launching database or downloading', () => {
    const result = spawnSync('node', ['scripts/ops.mjs', 'who-import', 'import'], {
      env: { ...process.env, WHO_ALLOW_CLINICAL_IMPORT: 'true', DB_PASSWORD: 'unused', WHO_SOURCE_DIR: '/nonexistent' },
      encoding: 'utf8'
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Explicit WHO import approval required')
  })

  it('avoids a runtime tsx cache write during migrations', () => {
    const launcher = readFileSync(new URL('../../scripts/ops.mjs', import.meta.url), 'utf8')
    expect(launcher).toContain('TSX_DISABLE_CACHE')
  })

  it('starts migrations through Node without Corepack before failing on an unreachable database', () => {
    const result = spawnSync('node', ['scripts/ops.mjs', 'db:migrate'], {
      env: { ...process.env, DB_PASSWORD: 'offline', DB_HOST: '127.0.0.1', DB_NAME: 'pediatrico_ops_offline_test', COREPACK_HOME: '/nonexistent-corepack', COREPACK_ENABLE_NETWORK: '0' },
      encoding: 'utf8', timeout: 30_000
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).not.toMatch(/Corepack|EACCES|download/i)
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/connect|ECONNREFUSED|database/i)
  })

  it('does not run WHO import automatically when the ops command is omitted', () => {
    const result = spawnSync('node', ['scripts/ops.mjs'], { env: { ...process.env, DB_PASSWORD: undefined, WHO_ALLOW_CLINICAL_IMPORT: 'yes' }, encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Database password required')
    expect(result.stderr).not.toContain('WHO')
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

  it('logs missing schema again after a different worker failure', async () => {
    vi.useFakeTimers()
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(acquireRecoveryWorker).mockResolvedValue({ isActive: vi.fn().mockResolvedValue(true), release: vi.fn() })
    vi.mocked(reconcileRecoveryJobs).mockRejectedValueOnce(Object.assign(new Error('missing table'), { code: '42P01' }))
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockRejectedValueOnce(Object.assign(new Error('missing table again'), { code: '42P01' }))
    const hooks = { hook: vi.fn() }
    try {
      recoveryPlugin({ hooks } as never)
      await vi.advanceTimersByTimeAsync(5500)
      expect(logger.mock.calls.map(call => JSON.parse(call[0]))).toEqual([
        { event: 'recovery_worker_failed', errorClass: 'schema not migrated' },
        { event: 'recovery_worker_failed', errorClass: 'WorkerError' },
        { event: 'recovery_worker_failed', errorClass: 'schema not migrated' }
      ])
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
