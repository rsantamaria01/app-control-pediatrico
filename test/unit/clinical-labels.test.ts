import { describe, expect, it } from 'vitest'
import { WhoIndicator } from '../../shared/utils/enums'
import { classify } from '../../shared/utils/clinical-labels'

const hfa = WhoIndicator.HEIGHT_FOR_AGE
const wfa = WhoIndicator.WEIGHT_FOR_AGE
const wfl = WhoIndicator.WEIGHT_FOR_LENGTH
const wfh = WhoIndicator.WEIGHT_FOR_HEIGHT
const bfa = WhoIndicator.BMI_FOR_AGE
const hcfa = WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE

describe('WHO 2006 provisional clinical labels', () => {
  it.each([
    [hfa, 12, -3.1, 'Talla baja severa', 'flag'],
    [hfa, 12, -2.1, 'Talla baja', 'flag'],
    [hfa, 12, 2.1, 'Talla alta para la edad', 'flag'],
    [wfa, 12, -3.1, 'Bajo peso severo', 'flag'],
    [wfa, 12, -2.1, 'Bajo peso', 'flag'],
    [wfa, 23, 2.1, 'Revisar peso/longitud', 'flag'],
    [wfa, 24, 2.1, 'Revisar IMC/edad', 'flag'],
    [wfl, 12, -3.1, 'Emaciación severa', 'flag'],
    [wfl, 12, -2.1, 'Emaciación', 'flag'],
    [wfl, 12, 1.1, 'Riesgo de sobrepeso', 'watch'],
    [wfl, 12, 2.1, 'Sobrepeso', 'flag'],
    [wfl, 12, 3.1, 'Obesidad', 'flag'],
    [wfh, 24, -3.1, 'Emaciación severa', 'flag'],
    [wfh, 24, -2.1, 'Emaciación', 'flag'],
    [wfh, 24, 1.1, 'Riesgo de sobrepeso', 'watch'],
    [wfh, 24, 2.1, 'Sobrepeso', 'flag'],
    [wfh, 24, 3.1, 'Obesidad', 'flag'],
    [bfa, 12, -3.1, 'Emaciación severa', 'flag'],
    [bfa, 12, -2.1, 'Emaciación', 'flag'],
    [bfa, 12, 1.1, 'Riesgo de sobrepeso', 'watch'],
    [bfa, 12, 2.1, 'Sobrepeso', 'flag'],
    [bfa, 12, 3.1, 'Obesidad', 'flag'],
    [bfa, 24, 1.1, 'Riesgo de sobrepeso', 'watch'],
    [hcfa, 12, -3.1, 'Microcefalia severa', 'flag'],
    [hcfa, 12, -2.1, 'Microcefalia', 'flag'],
    [hcfa, 12, 2.1, 'Macrocefalia', 'flag']
  ] as const)('%s at %s months, Z %s: %s', (indicator, age, z, name, tone) => {
    expect(classify(indicator, z, age)).toEqual({ name, tone })
  })

  it.each([hfa, wfa, wfl, wfh, bfa, hcfa])('keeps strict raw boundaries for %s', (indicator) => {
    const age = indicator === wfh ? 24 : 12
    expect(classify(indicator, -3, age).name).not.toMatch(/sever[ao]/i)
    expect(classify(indicator, -3 - 1e-10, age).name).toMatch(/sever[ao]/i)
    expect(classify(indicator, -2, age)).toEqual({ name: null, tone: 'neutral' })
    expect(classify(indicator, -2 - 1e-10, age).tone).toBe('flag')
    expect(classify(indicator, 2, age).tone).not.toBe('flag')
    expect(classify(indicator, 2 + 1e-10, age).tone).toBe('flag')
    expect(classify(indicator, 3, age).name).not.toBe('Obesidad')
    if (indicator === wfl || indicator === wfh || indicator === bfa) {
      expect(classify(indicator, 1, age)).toEqual({ name: null, tone: 'neutral' })
      expect(classify(indicator, 1 + 1e-10, age).tone).toBe('watch')
      expect(classify(indicator, 3 + 1e-10, age).name).toBe('Obesidad')
    }
  })

  it('does not classify by rounded display and never uses generic traffic-light statuses', () => {
    expect(classify(bfa, 1.9999, 20)).toEqual({ name: 'Riesgo de sobrepeso', tone: 'watch' })
    expect(classify(hfa, -1.9999, 20)).toEqual({ name: null, tone: 'neutral' })
    expect(classify(hcfa, -3.00001, 20).name).toBe('Microcefalia severa')
    for (const indicator of [hfa, wfa, wfl, wfh, bfa, hcfa]) {
      for (const z of [-4, -2.5, 0, 1.5, 2.5, 4]) {
        expect(classify(indicator, z, indicator === wfh ? 24 : 12).name ?? '').not.toMatch(/^(normal|vigilar|riesgo|alerta)$/i)
      }
    }
  })

  it('rejects unsupported ages, position branches and non-finite Z', () => {
    expect(classify(hfa, 0, 60)).toEqual({ name: null, tone: 'neutral' })
    expect(classify(wfl, 3.5, 24).name).toBe('Obesidad')
    expect(classify(wfh, 3.5, 23).name).toBe('Obesidad')
    expect(classify(bfa, Number.NaN, 12)).toEqual({ name: null, tone: 'neutral' })
  })
})
