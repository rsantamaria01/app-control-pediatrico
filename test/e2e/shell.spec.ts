import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'

for (const width of [375, 1440]) {
  test(`unauthenticated shell at ${width}px contains no unfinished navigation or clinical data`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 })
    await page.goto('/')
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { name: 'Control Pediátrico' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Solicitar cita' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-EC')
    await expect(page.getByRole('navigation')).toHaveCount(0)
    await expect(page.getByRole('link', { name: /pacientes|agenda|hijos|administración/i })).toHaveCount(0)
    await expect(page.getByText(/peso:|puntuación z|abrir ficha/i)).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    const response = await page.request.get('/')
    expect(response.headers()['cache-control']).toContain('no-store')
  })
}

test('deployment brand changes header logo and primary in both color modes without recoloring clinical tokens', async ({ page }) => {
  await page.goto('/acceso')
  await expect(page.getByRole('img', { name: 'Logo de la clínica' }).last()).toHaveAttribute('src', '/favicon.svg')
  await page.waitForLoadState('networkidle')
  const defaultPrimary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-primary').trim())
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('html')).toHaveClass(new RegExp(theme))
    const tokens = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement)
      return {
        primary: css.getPropertyValue('--ui-primary').trim(),
        patient: css.getPropertyValue('--color-patient').trim()
      }
    })
    expect(tokens.primary).toBeTruthy()
    if (theme === 'light') expect(tokens.primary).toBe(defaultPrimary)
    expect(tokens.patient).toBe(theme === 'light' ? '#1d4ed8' : '#60a5fa')
  }
})

test('production worker has no document precache or offline document fallback', async () => {
  const root = new URL('../..', import.meta.url)
  const locks = readdirSync(new URL('../../node_modules/.cache/nuxt/', import.meta.url)).filter(name => /^output-.*\.lock$/.test(name))
  let stale = false
  for (const name of locks) {
    const { pid, command, cwd } = JSON.parse(readFileSync(new URL(`../../node_modules/.cache/nuxt/${name}`, import.meta.url), 'utf8')) as { pid: number, command: string, cwd: string }
    if (command !== 'build' || cwd !== root.pathname.replace(/\/$/, '')) continue
    try {
      const status = readFileSync(`/proc/${pid}/status`, 'utf8').match(/^State:\s+(\S)/m)?.[1]
      if (status === 'Z') stale = true
      else if (status !== undefined) throw new Error(`Active Nuxt build lock: ${pid}`)
      else throw new Error(`Cannot verify Nuxt build lock: ${pid}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') stale = true
      else throw error
    }
  }
  if (stale) {
    const active = readdirSync('/proc').filter(name => /^\d+$/.test(name)).some((name) => {
      try {
        const command = readFileSync(`/proc/${name}/cmdline`, 'utf8').replaceAll('\0', ' ')
        return /(?:^|\s)(?:nuxt|nuxt\.mjs) build(?:\s|$)/.test(command) && readFileSync(`/proc/${name}/status`, 'utf8').match(/^State:\s+(\S)/m)?.[1] !== 'Z'
      } catch {
        return false
      }
    })
    if (active) throw new Error('Active Nuxt build exists; cannot bypass stale lock')
  }
  execFileSync('pnpm', ['build'], { cwd: root, stdio: 'pipe', env: stale ? { ...process.env, NUXT_IGNORE_LOCK: '1' } : process.env })
  const worker = readFileSync(new URL('../../.output/public/sw.js', import.meta.url), 'utf8')
  const captured: Array<{ path: string, mode: string, strategy: string }> = []
  const routes = {
    precacheAndRoute: (entries: Array<{ url: string }>) => {
      expect(entries.some(entry => /\.html(?:$|\?)/.test(entry.url))).toBe(false)
    },
    cleanupOutdatedCaches: () => {},
    clientsClaim: () => {},
    NetworkOnly: class NetworkOnly {
      readonly name = 'NetworkOnly'
    },
    registerRoute: (match: ({ request, url }: { request: { mode: string }, url: URL }) => boolean, strategy: object) => {
      for (const path of ['/', '/pacientes/123', '/api/pacientes']) {
        const mode = path.startsWith('/api') ? 'cors' : 'navigate'
        if (match({ request: { mode }, url: new URL(path, 'https://example.test') })) {
          captured.push({ path, mode, strategy: strategy.constructor.name })
        }
      }
    }
  }
  const execute = new Function('self', 'define', worker)
  execute({ skipWaiting() {}, location: { href: 'https://example.test/sw.js' } }, (_dependencies: string[], callback: (routes: typeof routes) => void) => callback(routes))
  expect(captured).toEqual(expect.arrayContaining([
    { path: '/', mode: 'navigate', strategy: 'NetworkOnly' },
    { path: '/pacientes/123', mode: 'navigate', strategy: 'NetworkOnly' },
    { path: '/api/pacientes', mode: 'cors', strategy: 'NetworkOnly' }
  ]))
  expect(worker).not.toMatch(/index\.html/)
  expect(worker).not.toMatch(/navigateFallback/)
  expect(worker).toMatch(/NetworkOnly/)
})

test('offline displays no stale clinical content', async ({ page, context }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await context.setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await expect(page.getByText('Sin conexión')).toBeVisible()
  await expect(page.getByText(/peso:|puntuación z|abrir ficha/i)).toHaveCount(0)
})
