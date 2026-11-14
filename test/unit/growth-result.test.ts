import { describe, expect, it } from 'vitest'
import type { ReferenceSelection } from '../../server/services/reference-selection'
import { Gender, WhoIndicator } from '../../shared/utils/enums'
import { calculateGrowth, formatGrowthValues } from '../../shared/utils/growth-result'
import { familyGrowthCopy } from '../../shared/utils/family-growth-copy'

const selected: ReferenceSelection = {
  datasetId: 'a'.repeat(64) as ReferenceSelection['datasetId'],
  standard: 'WHO_2006', version: 'WHO_2006_2026', publicationDate: '2006-01-01',
  sourceUrl: 'https://cdn.who.int/example.xlsx', sha256: 'b'.repeat(64),
  indicator: WhoIndicator.WEIGHT_FOR_AGE, sex: Gender.MALE,
  birthDate: new Date('2025-01-01T00:00:00Z'), measuredAt: new Date('2026-01-01T12:00:00Z'),
  measuredLengthHeightCm: 75, position: 'RECUMBENT', adjustedLengthHeightCm: 75,
  adjustmentCm: 0, referencePosition: null, ageBasis: 'CHRONOLOGICAL',
  chronologicalAgeDays: 365, referenceAgeDays: 365, gestationDays: null,
  prematurityDays: 0, correctionUntilMonths: 24, timeZone: 'America/Guayaquil',
  xUnit: 'DAY', x: 365, lms: { l: 1, m: 10, s: 0.1 }
}

const input = { weightKg: 10, lengthHeightCm: 75, headCircumferenceCm: 45, sex: Gender.MALE }

describe('pure growth result', () => {
  it('derives median percentile with immutable-ready provenance and no reference mutation', () => {
    const before = structuredClone(selected)
    const result = calculateGrowth(input, selected)
    expect(result).toMatchObject({ status: 'available', indicator: WhoIndicator.WEIGHT_FOR_AGE, sex: Gender.MALE,
      z: 0, percentile: 50, classification: { name: null, tone: 'neutral' },
      reference: { datasetId: selected.datasetId, standard: 'WHO_2006', version: selected.version,
        sourceUrl: selected.sourceUrl, sha256: selected.sha256, publicationDate: selected.publicationDate,
        ageBasis: 'CHRONOLOGICAL', referenceAgeDays: 365, chronologicalAgeDays: 365, x: 365, xUnit: 'DAY' } })
    expect(selected).toEqual(before)
    if (result.status === 'available') expect(Object.isFrozen(result.reference)).toBe(true)
  })

  it.each([
    [0, 50, 1e-7], [1, 84.1344746069, 0.00002], [-1, 15.8655253931, 0.00002],
    [2, 97.7249868052, 0.00002], [-2, 2.2750131948, 0.00002],
    [3, 99.8650101968, 0.00002], [-3, 0.1349898032, 0.00002],
    [4, 99.9968328759, 0.00002], [-4, 0.0031671241, 0.00002],
    [5, 99.9999713348, 0.00002], [-5, 0.0000286652, 0.00002],
    [5.4, 99.999996667955, 0.000005], [-7.17, 0.000000000037, 0.000000000005]
  ])('matches independently computed R pnorm at Z %s including extreme tails', (z, expected, tolerance) => {
    const result = calculateGrowth({ ...input, weightKg: 10 + z }, selected)
    expect(result.status).toBe('available')
    if (result.status === 'available') {
      expect(result.z).toBeCloseTo(z, 10)
      expect(Math.abs(result.percentile - expected)).toBeLessThan(tolerance)
    }
  })

  it('takes the adjusted length and independently derived BMI for the selected reference, never the unadjusted length', () => {
    const height = calculateGrowth({ ...input, lengthHeightCm: 74.3 }, {
      ...selected, indicator: WhoIndicator.HEIGHT_FOR_AGE, referencePosition: 'RECUMBENT',
      measuredLengthHeightCm: 74.3, adjustedLengthHeightCm: 75, adjustmentCm: 0.7,
      lms: { l: 1, m: 75, s: 0.1 }
    })
    expect(height.status === 'available' && height.z).toBe(0)
    const bmi = calculateGrowth({ ...input, weightKg: 12, lengthHeightCm: 100 }, {
      ...selected, indicator: WhoIndicator.BMI_FOR_AGE, measuredLengthHeightCm: 100,
      adjustedLengthHeightCm: 100, lms: { l: 1, m: 12, s: 0.1 }
    })
    expect(bmi.status === 'available' && bmi.z).toBe(0)
  })

  it('returns unavailable for missing reference, mismatched sex/measurement, 5 years or invalid LMS', () => {
    expect(calculateGrowth(input, { unavailableReason: 'WHO reference unavailable' })).toEqual({ status: 'unavailable', reason: 'WHO reference unavailable' })
    expect(calculateGrowth(input, { ...selected, measuredAt: new Date('2030-01-01T12:00:00Z'), chronologicalAgeDays: 1826 })).toMatchObject({ status: 'unavailable' })
    const leapBirthday = { ...selected, birthDate: new Date('2024-01-01T00:00:00Z'), measuredAt: new Date('2028-12-31T12:00:00Z'), chronologicalAgeDays: 1826 }
    expect(calculateGrowth(input, leapBirthday).status).toBe('available')
    expect(calculateGrowth(input, { ...selected, referenceAgeDays: 1856, x: 1856 }).status).toBe('available')
    expect(calculateGrowth(input, { ...selected, sex: Gender.FEMALE })).toMatchObject({ status: 'unavailable' })
    expect(calculateGrowth({ ...input, weightKg: Number.NaN }, selected)).toMatchObject({ status: 'unavailable' })
    expect(calculateGrowth(input, { ...selected, lms: { l: 1, m: 0, s: 0.1 } })).toMatchObject({ status: 'unavailable' })
    expect(calculateGrowth(input, { ...selected, version: '' })).toMatchObject({ status: 'unavailable' })
    expect(calculateGrowth(input, { ...selected, x: 366 })).toMatchObject({ status: 'unavailable' })
    expect(calculateGrowth(input, { ...selected, indicator: WhoIndicator.WEIGHT_FOR_LENGTH, xUnit: 'DAY', referencePosition: 'RECUMBENT' })).toMatchObject({ status: 'unavailable' })
    expect(calculateGrowth(input, { ...selected, adjustmentCm: 0.7, adjustedLengthHeightCm: 75 })).toMatchObject({ status: 'unavailable' })
    expect(calculateGrowth(input, { ...selected, indicator: WhoIndicator.WEIGHT_FOR_LENGTH, referencePosition: 'RECUMBENT', xUnit: 'CM', x: 75, referenceAgeDays: 731 })).toMatchObject({ status: 'unavailable' })
  })

  it('formats Z and percentile side by side with true minus, comma and positive sign', () => {
    expect(formatGrowthValues(-1.39, 8.24)).toBe('Z −1,39 · percentil 8,24')
    expect(formatGrowthValues(2.62, 99.56)).toBe('Z +2,62 · percentil 99,56')
    expect(formatGrowthValues(-4, 0.003167)).toBe('Z −4,00 · percentil 0,0032')
    expect(formatGrowthValues(5, 99.999971)).toBe('Z +5,00 · percentil 99,99997')
  })

  it('centralizes C10 family copy without clinical labels and reassures outside ±2 only', () => {
    const within = calculateGrowth(input, selected)
    expect(familyGrowthCopy(within, 'La doctora')).toBe('Peso: dentro del rango esperado · Z +0,00 · percentil 50,00')
    const outside = calculateGrowth({ ...input, weightKg: 7.5 }, selected)
    expect(familyGrowthCopy(outside, 'El doctor')).toBe('Peso: fuera del rango esperado · Z −2,50 · percentil 0,62. El doctor lo revisará con usted.')
    expect(familyGrowthCopy({ status: 'unavailable', reason: 'WHO reference unavailable' }, 'La doctora')).toBe('No disponible')
  })
})
