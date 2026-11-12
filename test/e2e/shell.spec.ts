import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

for (const width of [375, 1440]) {
  test(`unauthenticated shell at ${width}px contains no unfinished navigation or clinical data`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Control Pediátrico' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-EC')
    await expect(page.getByRole('button', { name: 'Cambiar tema' })).toHaveAttribute('aria-label', 'Cambiar tema')
    await expect(page.locator('header img[alt="Logo de la clínica"]')).toBeVisible()
    await expect(page.getByRole('link', { name: /control pediátrico/i })).toHaveAttribute('href', '/')
    await expect(page.getByRole('link', { name: /pacientes|agenda|hijos|administración/i })).toHaveCount(0)
    await expect(page.getByText(/peso:|puntuación z|abrir ficha/i)).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    const response = await page.request.get('/')
    expect(response.headers()['cache-control']).toContain('no-store')
  })
}

test('production worker has no document precache or offline document fallback', async () => {
  execFileSync('pnpm', ['build'], { cwd: new URL('../..', import.meta.url), stdio: 'pipe' })
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
