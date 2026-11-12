import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('defineNuxtConfig', (config: unknown) => config)
vi.stubGlobal('defineAppConfig', (config: unknown) => config)

const { default: nuxtConfig } = await import('../../nuxt.config')
const { default: appConfig } = await import('../../app/app.config')
const css = readFileSync(new URL('../../app/assets/css/main.css', import.meta.url), 'utf8')
const icon = readFileSync(new URL('../../public/favicon.svg', import.meta.url), 'utf8')
const chosenIcon = readFileSync(new URL('../../docs/design/icons/concept-a-curva.svg', import.meta.url), 'utf8')

function cssValue(name: string) {
  return css.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim()
}

describe('clinical shell configuration', () => {
  it('does not prerender or publicly cache session and clinical routes', () => {
    for (const path of ['/**', '/api/**']) {
      expect(nuxtConfig.routeRules[path]?.prerender, path).toBe(false)
      expect(nuxtConfig.routeRules[path]?.headers?.['cache-control'], path).toMatch(/no-store/)
    }
    expect(Object.values(nuxtConfig.routeRules).every(rule => rule.prerender === false)).toBe(true)
  })

  it('does not precache HTML or use an authenticated navigation fallback', () => {
    expect(nuxtConfig.pwa.workbox.globPatterns.join(',')).not.toContain('html')
    expect(nuxtConfig.pwa.workbox.navigateFallback).toBeNull()
    expect(nuxtConfig.pwa.workbox.navigateFallbackDenylist[0].test('/pacientes/123')).toBe(true)
    expect(nuxtConfig.pwa.workbox.navigateFallbackDenylist[0].test('/sin-conexion')).toBe(false)
    expect(nuxtConfig.pwa.workbox.runtimeCaching).toEqual(expect.arrayContaining([
      expect.objectContaining({ handler: 'NetworkOnly' })
    ]))
    expect(nuxtConfig.pwa.workbox.runtimeCaching[0].urlPattern({ url: new URL('https://example.test/api/pacientes') })).toBe(true)
  })

  it('keeps neutral, clinical and patient colors separate from the clinic primary palette', () => {
    expect(appConfig.ui.colors).toMatchObject({ primary: 'brand', neutral: 'slate' })
    for (const token of ['--color-z-flag', '--color-z-watch', '--color-curve-median', '--color-curve-sd1', '--color-curve-sd2', '--color-curve-sd3', '--color-patient']) {
      expect(cssValue(token), token).toMatch(/^#[0-9a-f]{6}$/i)
      expect(cssValue(token), token).not.toContain('brand')
    }
    expect(cssValue('--color-patient')).toBe('#1d4ed8')
  })

  it('uses the approved curve app icon', () => {
    expect(icon).toBe(chosenIcon)
  })

  it('has a deployment-configurable public origin rather than a fixed hostname', () => {
    expect(nuxtConfig.runtimeConfig.public.siteUrl).toBe('')
  })
})
