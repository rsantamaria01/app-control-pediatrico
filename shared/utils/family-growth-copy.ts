import type { GrowthResult } from '../types/clinical'
import { WhoIndicator } from './enums'
import { formatGrowthValues } from './growth-result'

const subject: Record<WhoIndicator, string> = {
  [WhoIndicator.HEIGHT_FOR_AGE]: 'Talla',
  [WhoIndicator.WEIGHT_FOR_AGE]: 'Peso',
  [WhoIndicator.WEIGHT_FOR_LENGTH]: 'Peso',
  [WhoIndicator.WEIGHT_FOR_HEIGHT]: 'Peso',
  [WhoIndicator.BMI_FOR_AGE]: 'IMC',
  [WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE]: 'Perímetro cefálico'
}

export function familyGrowthCopy(result: GrowthResult, doctorTitle: string): string {
  if (result.status === 'unavailable') return 'No disponible'
  const outside = result.z < -2 || result.z > 2
  return `${subject[result.indicator]}: ${outside ? 'fuera' : 'dentro'} del rango esperado · ${formatGrowthValues(result.z, result.percentile)}${outside ? `. ${doctorTitle} lo revisará con usted.` : ''}`
}
