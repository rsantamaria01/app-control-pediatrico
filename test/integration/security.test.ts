import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const enabled = process.env.ALPHA_COMPOSE_E2E === '1'
const origin = process.env.ALPHA_PUBLIC_ORIGIN
const password = process.env.ALPHA_ADMIN_PASSWORD

describe('production checkpoint security boundary', () => {
  it.skipIf(!enabled)('issues secure session cookies, denies clinical access to ADMIN and never caches authenticated responses', async () => {
    if (!origin?.startsWith('https://') || !password) throw new Error('Isolated HTTPS checkpoint required')
    const login = await fetch(`${origin}/api/auth/sign-in/username`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ username: 'firstadmin', password }) })
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie')
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite/i)
    const headers = { cookie: cookie!.split(';')[0]! }
    for (const path of ['/api/clinical/access-check', '/api/pacientes', '/api/hijos']) {
      const response = await fetch(`${origin}${path}`, { headers })
      expect(response.status, path).toBe(403)
      expect(response.headers.get('cache-control'), path).toContain('no-store')
    }
    const html = await fetch(`${origin}/`, { headers })
    expect(html.status).toBe(200)
    expect(html.headers.get('cache-control')).toContain('no-store')
    expect(await html.text()).not.toContain(password)
    const anonymous = await fetch(`${origin}/api/pacientes`)
    expect(anonymous.status).toBe(401)
    expect(anonymous.headers.get('cache-control')).toContain('no-store')
    const injected = await fetch(`${origin}/api/clinical/access-check`, { headers: { 'x-forwarded-for': '198.51.100.17', 'x-forwarded-proto': 'http' } })
    expect(injected.status).toBe(401)
    expect(injected.headers.get('cache-control')).toContain('no-store')
    const missing = await fetch(`${origin}/api/hijos/00000000-0000-4000-8000-000000000000/ausente`, { headers: { accept: 'application/json' } })
    expect(missing.status).toBe(404)
    expect(missing.headers.get('cache-control')).toContain('no-store')
    const peer = process.env.ALPHA_DIRECT_PEER_IP
    const proxy = process.env.ALPHA_PROXY_IP
    const project = process.env.ALPHA_COMPOSE_PROJECT
    if (!peer || !proxy || !project || !/^alphacheckpoint[a-f0-9]{12}$/.test(project)) throw new Error('Isolated proxy peer required')
    expect(peer).not.toBe(proxy)
    const ipKey = `auth:login:ip:${createHash('sha256').update(peer).digest('hex')}:attempts`
    const forgedKey = `auth:login:ip:${createHash('sha256').update('198.51.100.17').digest('hex')}:attempts`
    const probe = spawnSync('docker', ['run', '--rm', '--network', `${project}_default`, '--ip', peer, 'curlimages/curl:8.17.0', '-sS', '-o', '/dev/null', '-w', '%{http_code}', '-H', 'content-type: application/json', '-H', 'X-Forwarded-For: 198.51.100.17', '-H', 'X-Real-IP: 203.0.113.77', '-d', '{"username":"direct-peer","password":"wrong-password"}', 'http://app:3000/api/auth/sign-in/username'], { encoding: 'utf8' })
    expect(probe.status, probe.stderr).toBe(0)
    expect(probe.stdout).toBe('401')
    const readCount = (key: string) => spawnSync('docker', ['compose', '--env-file', '/dev/null', '--project-name', project, 'exec', '-T', 'cache', 'valkey-cli', 'GET', key], { encoding: 'utf8' })
    const peerCount = readCount(ipKey)
    const forgedCount = readCount(forgedKey)
    const sharedCount = readCount(`auth:login:ip:${createHash('sha256').update('shared').digest('hex')}:attempts`)
    const spoofedRealCount = readCount(`auth:login:ip:${createHash('sha256').update('203.0.113.77').digest('hex')}:attempts`)
    const usernameCount = readCount(`auth:login:user:${createHash('sha256').update('direct-peer').digest('hex')}:attempts`)
    for (const result of [peerCount, forgedCount, sharedCount, spoofedRealCount, usernameCount]) expect(result.status, result.stderr).toBe(0)
    expect(Number(usernameCount.stdout.trim())).toBeGreaterThan(0)
    expect(Number(peerCount.stdout.trim()), `peer=${peerCount.stdout.trim()} forged=${forgedCount.stdout.trim()} shared=${sharedCount.stdout.trim()}`).toBeGreaterThan(0)
    expect(sharedCount.stdout.trim()).toBe('')
    expect(forgedCount.stdout.trim()).toBe('')
    expect(spoofedRealCount.stdout.trim()).toBe('')
    const worker = await fetch(`${origin}/sw.js`)
    expect(worker.status).toBe(200)
    const source = await worker.text()
    expect(source).toContain('NetworkOnly')
    expect(source).not.toMatch(/url:["']\/?(?:pacientes|hijos|api)(?:\/|["'])/)
  })
})
