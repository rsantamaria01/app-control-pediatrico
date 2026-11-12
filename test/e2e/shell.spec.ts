import { expect, test } from '@playwright/test'

for (const width of [375, 1440]) {
  test(`unauthenticated shell at ${width}px contains no unfinished navigation or clinical data`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Control Pediátrico' })).toBeVisible()
    await expect(page.getByRole('link', { name: /pacientes|agenda|hijos|administración/i })).toHaveCount(0)
    await expect(page.getByText(/peso:|puntuación z|abrir ficha/i)).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    const response = await page.request.get('/')
    expect(response.headers()['cache-control']).toContain('no-store')
  })
}

test('offline displays no stale clinical content', async ({ page, context }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await context.setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await expect(page.getByText('Sin conexión')).toBeVisible()
  await expect(page.getByText(/peso:|puntuación z|abrir ficha/i)).toHaveCount(0)
})
