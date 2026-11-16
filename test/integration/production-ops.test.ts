import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import manifest from '../../scripts/who-2006-manifest.json'
import { describe, expect, it } from 'vitest'
import { Pool } from 'pg'

const source = process.env.TEST_DATABASE_URL
if (!source || new URL(source).pathname !== '/pediatrico_auth_slice2_test' || source === process.env.DATABASE_URL) throw new Error('Dedicated disposable test DB required')
const docker = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0
const database = `pediatrico_auth_slice2_ops_${process.pid}_test`
const adminUrl = new URL(source)
adminUrl.pathname = '/postgres'
const opsUrl = new URL(source)
opsUrl.pathname = `/${database}`

describe('built production ops image', () => {
  it.skipIf(!docker)('runs offline without Corepack or a writable runtime and rejects unapproved WHO imports', () => {
    const image = `pediatrico-ops-offline-${process.pid}`
    try {
      execFileSync('docker', ['build', '--target', 'ops', '-t', image, '.'], { stdio: 'pipe', timeout: 300_000 })
      const run = (args: string[], env: Record<string, string> = {}) => spawnSync('docker', ['run', '--rm', '--network', 'none', '--read-only', '-e', 'COREPACK_HOME=/unwritable-corepack', ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]), image, ...args], { encoding: 'utf8', timeout: 120_000 })
      const migration = run(['db:migrate'], { DB_PASSWORD: 'offline', DB_HOST: '127.0.0.1' })
      expect(migration.stderr).not.toMatch(/Corepack|EACCES|download/i)
      expect(migration.stderr).toMatch(/connect|ECONNREFUSED|ECONNRESET|database/i)
      const denied = run(['who-import', 'import'], { DB_PASSWORD: 'offline' })
      expect(denied.status).not.toBe(0)
      expect(denied.stderr).toContain('Explicit WHO import approval required')
      expect(denied.stderr).not.toMatch(/Corepack|EACCES/i)
    } finally {
      spawnSync('docker', ['image', 'rm', image], { stdio: 'ignore' })
    }
  }, 360_000)

  it.skipIf(!docker)('loads every schema module in the offline read-only ops image', () => {
    const image = `pediatrico-ops-schema-${process.pid}`
    try {
      execFileSync('docker', ['build', '--target', 'ops', '-t', image, '.'], { stdio: 'pipe', timeout: 300_000 })
      const result = spawnSync('docker', ['run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'node', image, '--experimental-transform-types', '--input-type=module', '-e', `import { readdir } from 'node:fs/promises'; import { pathToFileURL } from 'node:url'; const root = '/app/server/db/schema'; for (const name of await readdir(root, { recursive: true })) if (name.endsWith('.ts')) await import(pathToFileURL(root + '/' + name).href); const schema = await import(pathToFileURL('/app/server/db/schema.ts').href); if (!Object.keys(schema).length) process.exit(1)`], { encoding: 'utf8', timeout: 120_000 })
      expect(result.status, result.stderr.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted]')).toBe(0)
    } finally {
      spawnSync('docker', ['image', 'rm', image], { stdio: 'ignore' })
    }
  }, 360_000)

  it.skipIf(!docker)('runs migrations then bootstraps exactly once in a disposable database', async () => {
    const admin = new Pool({ connectionString: adminUrl.href })
    const image = `pediatrico-ops-test-${process.pid}`
    let created = false
    try {
      await admin.query(`CREATE DATABASE ${database}`)
      created = true
      execFileSync('docker', ['build', '--target', 'ops', '-t', image, '.'], { stdio: 'pipe', timeout: 300_000 })
      const containerUrl = new URL(opsUrl)
      if (containerUrl.hostname === 'db') containerUrl.hostname = 'host.docker.internal'
      if (containerUrl.hostname !== 'host.docker.internal' && containerUrl.hostname !== '127.0.0.1' && containerUrl.hostname !== 'localhost') throw new Error('Docker integration requires a locally reachable disposable database')
      const environment = { ...process.env, DB_PASSWORD: decodeURIComponent(containerUrl.password), DB_HOST: containerUrl.hostname, DB_NAME: database, BOOTSTRAP_ADMIN_USERNAME: 'firstadmin', BOOTSTRAP_ADMIN_EMAIL: 'first@example.test', NUXT_PUBLIC_SITE_URL: 'https://clinic.example.test' }
      const run = (command: string) => execFileSync('docker', ['run', '--rm', '--network', 'host', '--add-host', 'host.docker.internal:host-gateway', '--read-only', '-e', 'COREPACK_HOME=/unwritable-corepack', '-e', 'DB_PASSWORD', '-e', 'DB_HOST', '-e', 'DB_NAME', '-e', 'BOOTSTRAP_ADMIN_USERNAME', '-e', 'BOOTSTRAP_ADMIN_EMAIL', '-e', 'NUXT_PUBLIC_SITE_URL', image, command], { env: environment, encoding: 'utf8', timeout: 120_000 })
      run('prepare')
      const db = new Pool({ connectionString: opsUrl.href })
      try {
        const migrated = await db.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')
        expect(migrated.rows[0].count).toBeGreaterThan(0)
        expect((await db.query(`SELECT count(*)::int AS count FROM catalog_item WHERE release_id IN (SELECT id FROM catalog_release WHERE kind = 'VACCINE')`)).rows[0].count).toBe(21)
        expect((await db.query(`SELECT count(*)::int AS count FROM catalog_item WHERE release_id IN (SELECT id FROM catalog_release WHERE kind = 'CHECKUP')`)).rows[0].count).toBe(31)
        expect((await db.query(`SELECT count(*)::int AS count FROM catalog_release WHERE kind = 'MILESTONE'`)).rows[0].count).toBe(0)
        run('prepare')
        expect((await db.query('SELECT count(*)::int AS count FROM catalog_release')).rows[0].count).toBe(2)
        const link = run('bootstrap-admin')
        expect(link).toMatch(/https:\/\/clinic\.example\.test\/invitacion\/[\w-]+\s*$/)
        const roles = await db.query('SELECT role FROM user_role')
        expect(roles.rows.map(row => row.role)).toEqual(['ADMIN'])
        expect(() => run('bootstrap-admin')).toThrow()
      } finally {
        await db.end()
      }
    } finally {
      try {
        if (created) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`)
      } finally {
        await admin.end()
        spawnSync('docker', ['image', 'rm', image], { stdio: 'ignore' })
      }
    }
  })

  it.skipIf(!docker)('generates an admin credential through the read-only production ops image', async () => {
    const admin = new Pool({ connectionString: adminUrl.href })
    const name = `pediatrico_ops_password_${process.pid}_test`
    const target = new URL(source!)
    target.pathname = `/${name}`
    const image = `pediatrico-ops-password-${process.pid}`
    let created = false
    try {
      await admin.query(`CREATE DATABASE ${name}`)
      created = true
      execFileSync('docker', ['build', '--target', 'ops', '-t', image, '.'], { stdio: 'pipe', timeout: 300_000 })
      const containerUrl = new URL(target)
      if (containerUrl.hostname === 'db') containerUrl.hostname = 'host.docker.internal'
      if (!['host.docker.internal', '127.0.0.1', 'localhost'].includes(containerUrl.hostname)) throw new Error('Docker integration requires a locally reachable disposable database')
      const environment = { ...process.env, DB_PASSWORD: decodeURIComponent(containerUrl.password), DB_HOST: containerUrl.hostname, DB_NAME: name, BOOTSTRAP_ADMIN_USERNAME: 'firstadmin', BOOTSTRAP_ADMIN_EMAIL: 'first@example.test' }
      const run = (...args: string[]) => execFileSync('docker', ['run', '--rm', '--network', 'host', '--add-host', 'host.docker.internal:host-gateway', '--read-only', '-e', 'DB_PASSWORD', '-e', 'DB_HOST', '-e', 'DB_NAME', '-e', 'BOOTSTRAP_ADMIN_USERNAME', '-e', 'BOOTSTRAP_ADMIN_EMAIL', image, ...args], { env: environment, encoding: 'utf8', timeout: 120_000 })
      run('db:migrate')
      const password = run('bootstrap-admin', '--generated-password')
      expect(password).toMatch(/^[A-Za-z0-9_-]{43}\n$/)
      const db = new Pool({ connectionString: target.href })
      try {
        const { verifyPassword } = await import('better-auth/crypto')
        const result = await db.query('SELECT password FROM account WHERE provider_id = $1', ['credential'])
        expect(result.rows).toHaveLength(1)
        expect(await verifyPassword({ hash: result.rows[0].password, password: password.trim() })).toBe(true)
        expect(() => run('bootstrap-admin', '--generated-password')).toThrow()
      } finally {
        await db.end()
      }
    } finally {
      try {
        if (created) await admin.query(`DROP DATABASE ${name} WITH (FORCE)`)
      } finally {
        await admin.end()
        spawnSync('docker', ['image', 'rm', image], { stdio: 'ignore' })
      }
    }
  }, 360_000)

  it.skipIf(!docker || !manifest.files.every(file => existsSync(resolve('/tmp/opencode/who-2006', `${file.name}-expanded.xlsx`))))('imports offline cached originals with explicit approval and leaves them unchanged on retry', async () => {
    const admin = new Pool({ connectionString: adminUrl.href })
    const image = `pediatrico-ops-who-${process.pid}`
    const name = `pediatrico_ops_who_${process.pid}_test`
    const target = new URL(source!)
    target.pathname = `/${name}`
    let created = false
    try {
      await admin.query(`CREATE DATABASE ${name}`)
      created = true
      execFileSync('docker', ['build', '--target', 'ops', '-t', image, '.'], { stdio: 'pipe', timeout: 300_000 })
      const containerUrl = new URL(target)
      if (containerUrl.hostname === 'db') containerUrl.hostname = 'host.docker.internal'
      if (!['host.docker.internal', '127.0.0.1', 'localhost'].includes(containerUrl.hostname)) throw new Error('Docker integration requires a locally reachable disposable database')
      const environment = { ...process.env, DB_PASSWORD: decodeURIComponent(containerUrl.password), DB_HOST: containerUrl.hostname, DB_NAME: name }
      const run = (args: string[], approved = false) => execFileSync('docker', ['run', '--rm', '--network', 'host', '--add-host', 'host.docker.internal:host-gateway', '-v', '/tmp/opencode/who-2006:/who-source:ro', '-e', 'WHO_SOURCE_DIR=/who-source', '-e', 'COREPACK_HOME=/unwritable-corepack', '-e', 'DB_PASSWORD', '-e', 'DB_HOST', '-e', 'DB_NAME', ...(approved ? ['-e', 'WHO_ALLOW_CLINICAL_IMPORT=yes'] : []), image, ...args], { env: environment, encoding: 'utf8', timeout: 180_000 })
      run(['db:migrate'])
      expect(() => run(['who-import', 'import'])).toThrow()
      expect(run(['who-import', 'import'], true)).toContain('hcfa-girls: 1857 rows')
      const db = new Pool({ connectionString: target.href })
      try {
        expect((await db.query('SELECT count(*)::int AS n FROM who_dataset')).rows[0].n).toBe(12)
        expect((await db.query('SELECT count(*)::int AS n FROM who_reference_row')).rows[0].n).toBe(17260)
        expect(run(['who-import', 'import'], true)).toContain('wfa-boys: 1857 rows')
        expect((await db.query('SELECT count(*)::int AS n FROM who_reference_row')).rows[0].n).toBe(17260)
      } finally {
        await db.end()
      }
    } finally {
      try {
        if (created) await admin.query(`DROP DATABASE ${name} WITH (FORCE)`)
      } finally {
        await admin.end()
        spawnSync('docker', ['image', 'rm', image], { stdio: 'ignore' })
      }
    }
  }, 360_000)
})
