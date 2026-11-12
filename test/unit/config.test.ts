import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('defineNuxtConfig', (config: unknown) => config)
vi.stubGlobal('defineAppConfig', (config: unknown) => config)

const { default: nuxtConfig } = await import('../../nuxt.config')
const { default: appConfig } = await import('../../app/app.config')
const css = readFileSync(new URL('../../app/assets/css/main.css', import.meta.url), 'utf8')
const icon = readFileSync(new URL('../../public/favicon.svg', import.meta.url), 'utf8')
const chosenIcon = readFileSync(new URL('../../docs/design/icons/concept-a-curva.svg', import.meta.url), 'utf8')
const compose = readFileSync(new URL('../../.devcontainer/compose.dev.yaml', import.meta.url), 'utf8')
const devcontainer = JSON.parse(readFileSync(new URL('../../.devcontainer/devcontainer.json', import.meta.url), 'utf8'))

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

  it('keeps navigation requests network-only in the service worker', () => {
    const navigation = nuxtConfig.pwa.workbox.runtimeCaching.find(route => route.urlPattern({ request: { mode: 'navigate' }, url: new URL('https://example.test/pacientes') }))
    expect(navigation?.handler).toBe('NetworkOnly')
  })

  it('does not precache HTML or use an authenticated navigation fallback', () => {
    expect(nuxtConfig.pwa.workbox.globPatterns.join(',')).not.toContain('html')
    expect(nuxtConfig.pwa.workbox.navigateFallback).toBeNull()
    expect(nuxtConfig.pwa.workbox.navigateFallbackDenylist[0].test('/pacientes/123')).toBe(true)
    expect(nuxtConfig.pwa.workbox.navigateFallbackDenylist[0].test('/sin-conexion')).toBe(false)
    expect(nuxtConfig.pwa.workbox.runtimeCaching).toEqual(expect.arrayContaining([
      expect.objectContaining({ handler: 'NetworkOnly' })
    ]))
    expect(nuxtConfig.pwa.workbox.runtimeCaching[1].urlPattern({ request: { mode: 'cors' }, url: new URL('https://example.test/api/pacientes') })).toBe(true)
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

  it('loads GH_TOKEN from the host-only secrets env_file and keeps Git identity on rebuild', () => {
    expect(devcontainer.dockerComposeFile).toContain('compose.dev.yaml')
    expect(devcontainer.service).toBe('workspace')
    const workspace = compose.split('    env_file:')[1]?.split('\nvolumes:')[0]
    expect(workspace).toContain('/root/.config/app-monitoreo-pediatrico/secrets.env')
    expect(devcontainer.remoteEnv?.GH_TOKEN).toBe('${containerEnv:GH_TOKEN}')
    expect(workspace).not.toMatch(/^\s*GH_TOKEN:/m)
    for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) {
      expect(workspace).toMatch(new RegExp(`${key}:\\s*\\$\\{${key}:-[^}]+\\}`))
    }
    expect(workspace).not.toMatch(/GH_TOKEN:\s*\S{20,}/)
  })

  it('has a deployment-configurable public origin rather than a fixed hostname', () => {
    expect(nuxtConfig.runtimeConfig.public.siteUrl).toBe('')
  })
})
