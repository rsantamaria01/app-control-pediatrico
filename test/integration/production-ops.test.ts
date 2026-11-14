import { execFileSync, spawnSync } from 'node:child_process'
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
      const environment = { ...process.env, DATABASE_URL: containerUrl.href, BOOTSTRAP_ADMIN_USERNAME: 'firstadmin', BOOTSTRAP_ADMIN_EMAIL: 'first@example.test', NUXT_PUBLIC_SITE_URL: 'https://clinic.example.test' }
      const run = (command: string) => execFileSync('docker', ['run', '--rm', '--network', 'host', '--add-host', 'host.docker.internal:host-gateway', '-e', 'DATABASE_URL', '-e', 'BOOTSTRAP_ADMIN_USERNAME', '-e', 'BOOTSTRAP_ADMIN_EMAIL', '-e', 'NUXT_PUBLIC_SITE_URL', image, command], { env: environment, encoding: 'utf8', timeout: 120_000 })
      run('db:migrate')
      const db = new Pool({ connectionString: opsUrl.href })
      try {
        const migrated = await db.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')
        expect(migrated.rows[0].count).toBeGreaterThan(0)
        const link = run('bootstrap-admin')
        expect(link).toMatch(/^https:\/\/clinic\.example\.test\/invitacion\/[\w-]+\n$/)
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
})
