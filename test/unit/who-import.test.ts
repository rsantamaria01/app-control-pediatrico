import { describe, expect, it } from 'vitest'
import manifest from '../../scripts/who-2006-manifest.json'
import { Gender, WhoIndicator } from '../../shared/utils/enums'
import { parseWhoWorkbook, validateWhoRows } from '../../server/services/who-import'
import type { VerifiedSource, WhoRow } from '../../shared/types/who'

const bytes = new Uint8Array()
const pinned = manifest.files[0]!
const source: VerifiedSource = {
  publisher: 'WHO', standard: 'WHO_2006', version: manifest.version,
  publicationDate: pinned.publicationDate, retrievedAt: manifest.retrievedAt,
  url: pinned.url,
  sha256: pinned.sha256, bytes,
  indicator: WhoIndicator.WEIGHT_FOR_AGE, sex: Gender.MALE, position: null, xUnit: 'DAY',
  minX: 0, maxX: 1856, step: 1
}
const row: WhoRow = {
  indicator: WhoIndicator.WEIGHT_FOR_AGE, sex: Gender.MALE, position: null, xUnit: 'DAY',
  x: 0, l: 0.3487, m: 3.3464, s: 0.14602,
  sdNeg3: 2.08, sdNeg2: 2.459, sdNeg1: 2.881, sd0: 3.346,
  sd1: 3.859, sd2: 4.419, sd3: 5.031
}
const rows = Array.from({ length: 1857 }, (_, x) => ({ ...row, x }))

describe('WHO import validation', () => {
  it('rejects duplicate keys, missing x, wrong sex/units/position and outside coverage', () => {
    expect(() => validateWhoRows(source, [row, ...rows.slice(0, -1)])).toThrow()
    expect(() => validateWhoRows(source, rows.slice(0, -1))).toThrow()
    expect(() => validateWhoRows(source, [...rows.slice(0, -1), { ...row, x: 1857 }])).toThrow()
    expect(() => validateWhoRows(source, [row, { ...row, sex: Gender.FEMALE, x: 1 }, ...rows.slice(2)])).toThrow()
    expect(() => validateWhoRows(source, [row, { ...row, xUnit: 'CM', x: 1 }, ...rows.slice(2)])).toThrow()
    expect(() => validateWhoRows(source, [row, { ...row, position: 'STANDING', x: 1 }, ...rows.slice(2)])).toThrow()
    expect(() => validateWhoRows({ ...source, maxX: 1857 }, rows)).toThrow()
  })

  it('rejects incomplete or inconsistent SD values, nonfinite LMS and wrong table', async () => {
    expect(() => validateWhoRows(source, [row, { ...row, x: 1, sd3: undefined }, ...rows.slice(2)] as WhoRow[])).toThrow()
    expect(() => validateWhoRows(source, [row, { ...row, x: 1, sd2: 99 }, ...rows.slice(2)])).toThrow()
    expect(() => validateWhoRows(source, [row, { ...row, x: 1, m: Number.NaN }, ...rows.slice(2)])).toThrow()
    expect(() => validateWhoRows(source, [row, { ...row, x: 1, indicator: WhoIndicator.BMI_FOR_AGE }, ...rows.slice(2)])).toThrow()
    await expect(parseWhoWorkbook(source, Buffer.from('not xlsx'))).rejects.toThrow()
  })

  it('accepts a complete coherent pinned WHO table', () => {
    expect(validateWhoRows(source, rows)).toHaveLength(1857)
  })
})
