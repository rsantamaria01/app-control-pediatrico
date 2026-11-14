import { WhoIndicator } from './enums'

export type ChipTone = 'neutral' | 'watch' | 'flag'
export type ClinicalLabel = { name: string | null, tone: ChipTone }

type Rule = { above?: number, below?: number, name: string }

const low: Record<WhoIndicator, readonly Rule[]> = {
  [WhoIndicator.HEIGHT_FOR_AGE]: [{ below: -3, name: 'Talla baja severa' }, { below: -2, name: 'Talla baja' }],
  [WhoIndicator.WEIGHT_FOR_AGE]: [{ below: -3, name: 'Bajo peso severo' }, { below: -2, name: 'Bajo peso' }],
  [WhoIndicator.WEIGHT_FOR_LENGTH]: [{ below: -3, name: 'Emaciación severa' }, { below: -2, name: 'Emaciación' }],
  [WhoIndicator.WEIGHT_FOR_HEIGHT]: [{ below: -3, name: 'Emaciación severa' }, { below: -2, name: 'Emaciación' }],
  [WhoIndicator.BMI_FOR_AGE]: [{ below: -3, name: 'Emaciación severa' }, { below: -2, name: 'Emaciación' }],
  [WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE]: [{ below: -3, name: 'Microcefalia severa' }, { below: -2, name: 'Microcefalia' }]
}

const high: Record<WhoIndicator, readonly Rule[]> = {
  [WhoIndicator.HEIGHT_FOR_AGE]: [{ above: 2, name: 'Talla alta para la edad' }],
  [WhoIndicator.WEIGHT_FOR_AGE]: [],
  [WhoIndicator.WEIGHT_FOR_LENGTH]: [{ above: 3, name: 'Obesidad' }, { above: 2, name: 'Sobrepeso' }, { above: 1, name: 'Riesgo de sobrepeso' }],
  [WhoIndicator.WEIGHT_FOR_HEIGHT]: [{ above: 3, name: 'Obesidad' }, { above: 2, name: 'Sobrepeso' }, { above: 1, name: 'Riesgo de sobrepeso' }],
  [WhoIndicator.BMI_FOR_AGE]: [{ above: 3, name: 'Obesidad' }, { above: 2, name: 'Sobrepeso' }, { above: 1, name: 'Riesgo de sobrepeso' }],
  [WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE]: [{ above: 2, name: 'Macrocefalia' }]
}

export function classify(indicator: WhoIndicator, rawZ: number, ageMonths: number): ClinicalLabel {
  const neutral: ClinicalLabel = { name: null, tone: 'neutral' }
  if (!Number.isFinite(rawZ) || !Number.isFinite(ageMonths) || ageMonths < 0 || ageMonths >= 60
    || !low[indicator]) return neutral
  const rule = [...low[indicator], ...high[indicator]].find(rule =>
    (rule.below !== undefined && rawZ < rule.below) || (rule.above !== undefined && rawZ > rule.above))
  if (indicator === WhoIndicator.WEIGHT_FOR_AGE && rawZ > 2) {
    return { name: ageMonths < 24 ? 'Revisar peso/longitud' : 'Revisar IMC/edad', tone: 'flag' }
  }
  if (!rule) return neutral
  return { name: rule.name, tone: rawZ < -2 || rawZ > 2 ? 'flag' : 'watch' }
}
