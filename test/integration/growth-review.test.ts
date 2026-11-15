import { describe, expect, it } from 'vitest'
import { evaluateGrowthReview } from '../../server/services/growth-review'

type Reading = { measuredAt: string, indicator: string, z: number | null, reference: string, ageBasis: string }
const reading = (day: number, z: number | null, indicator = 'WEIGHT_FOR_AGE', reference = 'WHO2006', ageBasis = 'CHRONOLOGICAL'): Reading => ({ measuredAt: `2026-01-${String(day).padStart(2, '0')}T12:00:00Z`, indicator, z, reference, ageBasis })

describe('doctor growth review membership', () => {
  it('uses strict raw Z boundaries and configurable threshold', () => {
    expect(evaluateGrowthReview([reading(1, 2), reading(29, 2)])).toEqual([])
    expect(evaluateGrowthReview([reading(29, -2)])).toEqual([])
    expect(evaluateGrowthReview([reading(1, 0), reading(29, 2.0001)])).toContain('WEIGHT_FOR_AGE')
    expect(evaluateGrowthReview([reading(1, 0), reading(29, -2.0001)])).toContain('WEIGHT_FOR_AGE')
    expect(evaluateGrowthReview([reading(1, 0), reading(29, 2.1)], { outsideZ: 2.2, deltaZ: 3, minDays: 28 })).toEqual([])
  })

  it('compares latest two comparable visits at the four-week boundary and includes equality at delta 1', () => {
    expect(evaluateGrowthReview([reading(1, 0), reading(29, 1)])).toContain('WEIGHT_FOR_AGE')
    expect(evaluateGrowthReview([reading(2, 0), reading(29, 1)])).toEqual([])
    expect(evaluateGrowthReview([reading(1, 0), reading(29, 1)], { outsideZ: 2, deltaZ: 1.1, minDays: 28 })).toEqual([])
    expect(evaluateGrowthReview([reading(1, 0), reading(29, 1), reading(30, 1.1)])).toContain('WEIGHT_FOR_AGE')
    expect(evaluateGrowthReview([reading(1, 0), reading(15, 0.4), reading(29, 1)])).toContain('WEIGHT_FOR_AGE')
  })

  it('never fills missing references or compares different indicator, version, or age basis', () => {
    expect(evaluateGrowthReview([reading(1, 0), reading(29, null)])).toEqual([])
    expect(evaluateGrowthReview([reading(1, 0), reading(29, 1, 'WEIGHT_FOR_AGE', '')])).toEqual([])
    expect(evaluateGrowthReview([reading(1, 0), reading(29, 1), reading(30, null)])).toEqual([])
    expect(evaluateGrowthReview([reading(1, 0), reading(29, null), reading(30, 1.1)])).toContain('WEIGHT_FOR_AGE')
    expect(evaluateGrowthReview([reading(1, 0), reading(29, 1, 'BMI_FOR_AGE')])).toEqual([])
    expect(evaluateGrowthReview([reading(1, 0), reading(29, 1, 'WEIGHT_FOR_AGE', 'WHO2007')])).toEqual([])
    expect(evaluateGrowthReview([reading(1, 0), reading(29, 1, 'WEIGHT_FOR_AGE', 'WHO2006', 'CORRECTED')])).toEqual([])
  })
})
