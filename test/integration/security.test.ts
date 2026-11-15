import { describe, expect, it } from 'vitest'

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
    const worker = await fetch(`${origin}/sw.js`)
    expect(worker.status).toBe(200)
    const source = await worker.text()
    expect(source).toContain('NetworkOnly')
    expect(source).not.toMatch(/url:["']\/?(?:pacientes|hijos|api)(?:\/|["'])/)
  })
})
