import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('MSP source identity gate', () => {
  it('verifies both tracked originals but never claims clinical validation', () => {
    const output = execFileSync('pnpm', ['exec', 'tsx', 'scripts/import-preventive-catalogs.ts', 'verify'], { cwd: resolve('.'), encoding: 'utf8' })
    expect(output).toContain('a8c3b8d24f89fe6fbde8c99961eb7e6f0681e9894260338685e4b5d9b5e689b0')
    expect(output).toContain('ae01652bb3f48d40a923aca9692d815c0e7f9bfa613b6f77d86c052c61c49dd7')
    expect(output).toContain('periodicity_schedule.pdf')
  })

  it('refuses import without a configured database rather than claiming a seed succeeded', () => {
    expect(() => execFileSync('pnpm', ['exec', 'tsx', 'scripts/import-preventive-catalogs.ts', 'import'], { cwd: resolve('.'), env: { ...process.env, DATABASE_URL: '' }, stdio: 'pipe' })).toThrow()
  })
})
