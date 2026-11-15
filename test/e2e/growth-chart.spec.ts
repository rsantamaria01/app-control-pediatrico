import { expect, test } from '@playwright/test'

test('growth pages require a verified session at phone and desktop widths', async ({ page }) => {
  for (const width of [375, 1024, 1440]) {
    await page.setViewportSize({ width, height: 812 })
    for (const path of ['/pacientes/00000000-0000-4000-8000-000000000000', '/hijos/00000000-0000-4000-8000-000000000000/crecimiento', '/api/hijos/00000000-0000-4000-8000-000000000000/crecimiento']) {
      if (path.startsWith('/api/')) {
        const denied = await page.request.get(path)
        expect(denied.status()).toBe(401)
        expect(denied.headers()['cache-control']).toContain('no-store')
        continue
      }
      const response = await page.goto(path)
      expect(response?.headers()['cache-control']).toContain('no-store')
      await expect(page.getByText(/No se pudo abrir la ficha|No se pudo consultar esta información/)).toBeVisible()
      await expect(page.getByRole('heading', { name: /curvas|crecimiento|mediciones/i })).toHaveCount(0)
    }
  }
})
