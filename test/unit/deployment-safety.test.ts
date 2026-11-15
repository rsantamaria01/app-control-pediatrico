import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = new URL('../..', import.meta.url)
const compose = readFileSync(new URL('../../compose.yaml', import.meta.url), 'utf8')
const password = 'part:@/?#% with space'

describe('deployment safety', () => {
  it('passes an encoded password to the app and ops without logging it or leaving the raw secret in child env', () => {
    for (const service of ['app', 'ops']) {
      const section = compose.split(new RegExp(`\\n  ${service}:\\n`))[1]?.split(/\n {2}(?:app|ops|db):\n/)[0]
      expect(section).not.toContain('postgres://pediatrico:${DB_PASSWORD')
      expect(section).toContain('DB_PASSWORD:')
      expect(section).toContain('DB_HOST: db')
      expect(section).toContain('DB_NAME: ${DB_NAME:-pediatrico}')
    }
    const result = spawnSync('node', ['scripts/database-env.mjs', 'node', '-e', 'process.stdout.write(JSON.stringify({url:process.env.DATABASE_URL,raw:process.env.DB_PASSWORD}))'], {
      cwd: root, env: { ...process.env, DB_PASSWORD: password }, encoding: 'utf8'
    })
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    const child = JSON.parse(result.stdout)
    expect(child.raw).toBeUndefined()
    expect(child.url).not.toContain(password)
    expect(child.url).toContain('part%3A%40%2F%3F%23%25%20with%20space')
    expect(new URL(child.url).password).toBe('part%3A%40%2F%3F%23%25%20with%20space')
  })

  it.each([
    ['172.20.0.0/16', '172.20.0.1', '172.20.255.254', '172.20.255.253'],
    ['172.21.32.0/20', '172.21.32.1', '172.21.47.254', '172.21.47.253'],
    ['172.22.8.0/24', '172.22.8.1', '172.22.8.254', '172.22.8.253']
  ])('selects two distinct unused peers inside actual Docker subnet %s', (subnet, gateway, proxy, peer) => {
    const network = [{ IPAM: { Config: [{ Subnet: subnet, Gateway: gateway }] }, Containers: { db: { IPv4Address: `${gateway}/${subnet.split('/')[1]}` } } }]
    const result = spawnSync('node', ['scripts/ci-alpha-network.mjs'], { cwd: root, input: JSON.stringify(network), encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ proxy, peer })
  })

  it('does not allocate occupied addresses or accept an invalid Docker subnet', () => {
    const network = [{ IPAM: { Config: [{ Subnet: '172.22.8.0/24', Gateway: '172.22.8.1' }] }, Containers: { db: { IPv4Address: '172.22.8.254/24' } } }]
    const occupied = spawnSync('node', ['scripts/ci-alpha-network.mjs'], { cwd: root, input: JSON.stringify(network), encoding: 'utf8' })
    expect(occupied.status, occupied.stderr).toBe(0)
    expect(JSON.parse(occupied.stdout)).toEqual({ proxy: '172.22.8.253', peer: '172.22.8.252' })
    for (const config of [{ Subnet: '172.22.8.0/24', Gateway: '172.22.9.1' }, { Subnet: '172.22.8.1/24', Gateway: '172.22.8.2' }]) {
      const invalid = spawnSync('node', ['scripts/ci-alpha-network.mjs'], { cwd: root, input: JSON.stringify([{ ...network[0], IPAM: { Config: [config] } }]), encoding: 'utf8' })
      expect(invalid.status).not.toBe(0)
      expect(invalid.stdout).toBe('')
    }
  })

  it('fails closed when Docker cannot provide two distinct unoccupied addresses', () => {
    const network: { IPAM: { Config: { Subnet: string, Gateway: string }[] }, Containers: Record<string, { IPv4Address: string }> }[] = [{ IPAM: { Config: [{ Subnet: '172.22.8.0/28', Gateway: '172.22.8.1' }] }, Containers: {} }]
    const occupied = Array.from({ length: 12 }, (_, index) => index + 2)
    for (const octet of occupied) network[0]!.Containers[`peer${octet}`] = { IPv4Address: `172.22.8.${octet}/28` }
    const result = spawnSync('node', ['scripts/ci-alpha-network.mjs'], { cwd: root, input: JSON.stringify(network), encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
  })

  it('does not trust an entire container bridge for the alpha reverse proxy', () => {
    const script = readFileSync(new URL('../../scripts/ci-alpha-compose.sh', import.meta.url), 'utf8')
    expect(script).not.toContain('AUTH_TRUSTED_PROXY_CIDR=172.16.0.0/12')
    expect(script).toMatch(/AUTH_TRUSTED_PROXY_CIDR=.*\/32/)
    expect(script).toContain('ALPHA_DIRECT_PEER_IP')
    expect(script).toContain('docker network inspect "${project}_default" | node scripts/ci-alpha-network.mjs --space')
    expect(script).not.toContain('network_subnet%.*/*')
  })

  it('forwards configured public HTTPS origin and secrets explicitly to the production image', () => {
    const app = compose.split('\n  app:\n')[1]?.split('\n  ops:\n')[0]
    expect(app).toContain('NUXT_APP_SECRET: ${NUXT_APP_SECRET:?')
    expect(app).toContain('RECOVERY_QUEUE_SECRET: ${RECOVERY_QUEUE_SECRET:?')
    expect(app).toContain('NUXT_PUBLIC_SITE_URL: ${NUXT_PUBLIC_SITE_URL:?')
    expect(app).toContain('AUTH_TRUSTED_PROXY_CIDR: ${AUTH_TRUSTED_PROXY_CIDR:-}')
  })

  it('runs independent WHO Anthro comparisons against isolated checkpoint database without skips', () => {
    const script = readFileSync(new URL('../../scripts/ci-alpha-compose.sh', import.meta.url), 'utf8')
    expect(script).toContain('WHO_TEST_DATABASE_URL=')
    expect(script).toContain('who-reference.test.ts')
    expect(script).toContain('reference-selection.test.ts')
    expect(script).toContain('numPendingTests')
    expect(script).toContain('numFailedTests')
  })

  it('stops the worker before streaming the backup and requires a RustFS snapshot before migrating', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pediatric-ops-'))
    try {
      const docker = join(dir, 'docker')
      writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\nif [ "$*" = "compose --profile full exec -T db pg_dump -U pediatrico -d pediatrico -Fc" ]; then printf archive; fi\n')
      chmodSync(docker, 0o755)
      const result = spawnSync('sh', ['scripts/upgrade.sh'], { cwd: root, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALL_LOG: join(dir, 'calls'), BACKUP_DIR: dir }, input: 'snapshot-verified\n', encoding: 'utf8' })
      expect(result.status).toBe(0)
      expect(readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n')).toEqual([
        'compose --profile full build app ops',
        'compose --profile full stop app',
        'compose --profile full ps --status running -q app',
        'compose --profile full exec -T db pg_dump -U pediatrico -d pediatrico -Fc',
        'compose --profile full exec -T db pg_restore --list',
        'compose --profile full run --rm ops db:migrate',
        'compose --profile full up -d --no-build'
      ])
      expect(result.stdout).not.toContain('archive')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not migrate when confirmation is incorrect', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pediatric-ops-'))
    try {
      const docker = join(dir, 'docker')
      writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\nif [ "$*" = "compose --profile full exec -T db pg_dump -U pediatrico -d pediatrico -Fc" ]; then printf archive; fi\n')
      chmodSync(docker, 0o755)
      const result = spawnSync('sh', ['scripts/upgrade.sh'], { cwd: root, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALL_LOG: join(dir, 'calls'), BACKUP_DIR: dir }, input: 'no\n', encoding: 'utf8' })
      expect(result.status).not.toBe(0)
      expect(readFileSync(join(dir, 'calls'), 'utf8')).not.toContain('run --rm ops')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps the app stopped when RustFS snapshot confirmation is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pediatric-ops-'))
    try {
      const docker = join(dir, 'docker')
      writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\nif [ "$*" = "compose --profile full exec -T db pg_dump -U pediatrico -d pediatrico -Fc" ]; then printf archive; fi\n')
      chmodSync(docker, 0o755)
      const result = spawnSync('sh', ['scripts/upgrade.sh'], { cwd: root, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALL_LOG: join(dir, 'calls'), BACKUP_DIR: dir }, input: '', encoding: 'utf8' })
      expect(result.status).not.toBe(0)
      expect(readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n')).toEqual([
        'compose --profile full build app ops',
        'compose --profile full stop app',
        'compose --profile full ps --status running -q app',
        'compose --profile full exec -T db pg_dump -U pediatrico -d pediatrico -Fc',
        'compose --profile full exec -T db pg_restore --list'
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects an invalid database archive before allowing migration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pediatric-ops-'))
    try {
      const docker = join(dir, 'docker')
      writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\nif [ "$*" = "compose --profile full exec -T db pg_dump -U pediatrico -d pediatrico -Fc" ]; then printf archive; fi\nif [ "$*" = "compose --profile full exec -T db pg_restore --list" ]; then exit 22; fi\n')
      chmodSync(docker, 0o755)
      const result = spawnSync('sh', ['scripts/upgrade.sh'], { cwd: root, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALL_LOG: join(dir, 'calls'), BACKUP_DIR: dir }, input: 'snapshot-verified\n', encoding: 'utf8' })
      expect(result.status).not.toBe(0)
      expect(readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n')).toEqual([
        'compose --profile full build app ops',
        'compose --profile full stop app',
        'compose --profile full ps --status running -q app',
        'compose --profile full exec -T db pg_dump -U pediatrico -d pediatrico -Fc',
        'compose --profile full exec -T db pg_restore --list'
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not migrate when the database backup stream fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pediatric-ops-'))
    try {
      const docker = join(dir, 'docker')
      writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\nif [ "$*" = "compose --profile full exec -T db pg_dump -U pediatrico -d pediatrico -Fc" ]; then exit 21; fi\n')
      chmodSync(docker, 0o755)
      const result = spawnSync('sh', ['scripts/upgrade.sh'], { cwd: root, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALL_LOG: join(dir, 'calls'), BACKUP_DIR: dir }, input: 'snapshot-verified\n', encoding: 'utf8' })
      expect(result.status).not.toBe(0)
      expect(readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n')).toEqual([
        'compose --profile full build app ops',
        'compose --profile full stop app',
        'compose --profile full ps --status running -q app',
        'compose --profile full exec -T db pg_dump -U pediatrico -d pediatrico -Fc'
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not overwrite an existing backup when retrying an upgrade', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pediatric-ops-'))
    try {
      writeFileSync(join(dir, 'clinic.dump'), 'previous backup')
      const docker = join(dir, 'docker')
      writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\n')
      chmodSync(docker, 0o755)
      const result = spawnSync('sh', ['scripts/upgrade.sh'], { cwd: root, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALL_LOG: join(dir, 'calls'), BACKUP_DIR: dir }, input: 'snapshot-verified\n', encoding: 'utf8' })
      expect(result.status).not.toBe(0)
      expect(readFileSync(join(dir, 'clinic.dump'), 'utf8')).toBe('previous backup')
      expect(readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n')).toEqual([
        'compose --profile full build app ops',
        'compose --profile full stop app',
        'compose --profile full ps --status running -q app'
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not migrate if backup destination is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pediatric-ops-'))
    try {
      const docker = join(dir, 'docker')
      writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\n')
      chmodSync(docker, 0o755)
      const result = spawnSync('sh', ['scripts/upgrade.sh'], { cwd: root, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALL_LOG: join(dir, 'calls'), BACKUP_DIR: join(dir, 'absent') }, encoding: 'utf8' })
      expect(result.status).not.toBe(0)
      expect(readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n')).toEqual([
        'compose --profile full build app ops',
        'compose --profile full stop app',
        'compose --profile full ps --status running -q app'
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not start the app when migration fails after it stops serving', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pediatric-ops-'))
    try {
      const docker = join(dir, 'docker')
      writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\nif [ "$*" = "compose --profile full exec -T db pg_dump -U pediatrico -d pediatrico -Fc" ]; then printf archive; fi\nif [ "$*" = "compose --profile full run --rm ops db:migrate" ]; then exit 13; fi\n')
      chmodSync(docker, 0o755)
      const result = spawnSync('sh', ['scripts/upgrade.sh'], { cwd: root, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALL_LOG: join(dir, 'calls'), BACKUP_DIR: dir }, input: 'snapshot-verified\n', encoding: 'utf8' })
      expect(result.status).toBe(13)
      expect(readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n')).toEqual([
        'compose --profile full build app ops',
        'compose --profile full stop app',
        'compose --profile full ps --status running -q app',
        'compose --profile full exec -T db pg_dump -U pediatrico -d pediatrico -Fc',
        'compose --profile full exec -T db pg_restore --list',
        'compose --profile full run --rm ops db:migrate'
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('propagates child failure without printing the password', () => {
    const result = spawnSync('node', ['scripts/database-env.mjs', 'node', '-e', 'process.exit(19)'], {
      cwd: root, env: { ...process.env, DB_PASSWORD: password }, encoding: 'utf8'
    })
    expect(result.status).toBe(19)
    expect(result.stderr).not.toContain(password)
  })

  it('replaces an inherited connection URL instead of forwarding it', () => {
    const result = spawnSync('node', ['scripts/database-env.mjs', 'node', '-e', 'process.stdout.write(process.env.DATABASE_URL)'], {
      cwd: root, env: { ...process.env, DB_PASSWORD: password, DATABASE_URL: 'postgres://wrong@other:5432/other' }, encoding: 'utf8'
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('@db:5432/pediatrico')
    expect(result.stdout).not.toContain('other')
  })

  it('rejects an absent password without starting the child', () => {
    const result = spawnSync('node', ['scripts/database-env.mjs', 'node', '-e', 'process.stdout.write("started")'], {
      cwd: root, env: { PATH: process.env.PATH }, encoding: 'utf8'
    })
    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toContain(password)
  })

  it('uses the configured isolated database host and name in the child URL', () => {
    const result = spawnSync('node', ['scripts/database-env.mjs', 'node', '-e', 'process.stdout.write(process.env.DATABASE_URL)'], {
      cwd: root, env: { ...process.env, DB_PASSWORD: password, DB_HOST: '127.0.0.1', DB_NAME: 'pediatrico_restore_test' }, encoding: 'utf8'
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('postgres://pediatrico:part%3A%40%2F%3F%23%25%20with%20space@127.0.0.1:5432/pediatrico_restore_test')
  })

  it('rejects a database target containing URL delimiters', () => {
    const result = spawnSync('node', ['scripts/database-env.mjs', 'node', '-e', 'process.stdout.write("started")'], {
      cwd: root, env: { ...process.env, DB_PASSWORD: password, DB_HOST: 'db@other-host' }, encoding: 'utf8'
    })
    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toContain(password)
  })

  it('stops the old app and refuses to migrate if it is still running', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pediatric-ops-'))
    try {
      const docker = join(dir, 'docker')
      writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\nif [ "$*" = "compose --profile full ps --status running -q app" ]; then printf "old-app-id\\n"; fi\n')
      chmodSync(docker, 0o755)
      const result = spawnSync('sh', ['scripts/upgrade.sh'], { cwd: root, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALL_LOG: join(dir, 'calls') }, encoding: 'utf8' })
      expect(result.status).not.toBe(0)
      expect(readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n')).toEqual([
        'compose --profile full build app ops',
        'compose --profile full stop app',
        'compose --profile full ps --status running -q app'
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not stop or migrate when building new images fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pediatric-ops-'))
    try {
      const docker = join(dir, 'docker')
      writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\nexit 11\n')
      chmodSync(docker, 0o755)
      const result = spawnSync('sh', ['scripts/upgrade.sh'], { cwd: root, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALL_LOG: join(dir, 'calls') }, encoding: 'utf8' })
      expect(result.status).toBe(11)
      expect(readFileSync(join(dir, 'calls'), 'utf8').trim()).toBe('compose --profile full build app ops')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not migrate when the running-state check fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pediatric-ops-'))
    try {
      const docker = join(dir, 'docker')
      writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\nif [ "$*" = "compose --profile full ps --status running -q app" ]; then exit 17; fi\n')
      chmodSync(docker, 0o755)
      const result = spawnSync('sh', ['scripts/upgrade.sh'], { cwd: root, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALL_LOG: join(dir, 'calls') }, encoding: 'utf8' })
      expect(result.status).not.toBe(0)
      expect(readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n')).toEqual([
        'compose --profile full build app ops',
        'compose --profile full stop app',
        'compose --profile full ps --status running -q app'
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('migrates only after confirming the old app is stopped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pediatric-ops-'))
    try {
      const docker = join(dir, 'docker')
      writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\nif [ "$*" = "compose --profile full exec -T db pg_dump -U pediatrico -d pediatrico -Fc" ]; then printf archive; fi\n')
      chmodSync(docker, 0o755)
      execFileSync('sh', ['scripts/upgrade.sh'], { cwd: root, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALL_LOG: join(dir, 'calls'), BACKUP_DIR: dir }, input: 'snapshot-verified\n' })
      expect(readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n')).toEqual([
        'compose --profile full build app ops',
        'compose --profile full stop app',
        'compose --profile full ps --status running -q app',
        'compose --profile full exec -T db pg_dump -U pediatrico -d pediatrico -Fc',
        'compose --profile full exec -T db pg_restore --list',
        'compose --profile full run --rm ops db:migrate',
        'compose --profile full up -d --no-build'
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
