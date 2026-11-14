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
      expect(section).toContain('DB_NAME: pediatrico')
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

  it('does not start the app when migration fails after it stops serving', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pediatric-ops-'))
    try {
      const docker = join(dir, 'docker')
      writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\nif [ "$*" = "compose --profile full run --rm ops db:migrate" ]; then exit 13; fi\n')
      chmodSync(docker, 0o755)
      const result = spawnSync('sh', ['scripts/upgrade.sh'], { cwd: root, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALL_LOG: join(dir, 'calls') }, encoding: 'utf8' })
      expect(result.status).toBe(13)
      expect(readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n')).toEqual([
        'compose --profile full build app ops',
        'compose --profile full stop app',
        'compose --profile full ps --status running -q app',
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
      writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\n')
      chmodSync(docker, 0o755)
      execFileSync('sh', ['scripts/upgrade.sh'], { cwd: root, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALL_LOG: join(dir, 'calls') } })
      expect(readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n')).toEqual([
        'compose --profile full build app ops',
        'compose --profile full stop app',
        'compose --profile full ps --status running -q app',
        'compose --profile full run --rm ops db:migrate',
        'compose --profile full up -d --no-build'
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
