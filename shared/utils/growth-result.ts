import type { ReferenceSelection } from '../../server/services/reference-selection'
import type { GrowthResult, GrowthMeasurementInput } from '../types/clinical'
import { classify } from './clinical-labels'
import { Gender, WhoIndicator } from './enums'
import { bmi, correctZ } from './zscore'

function normalCdf(z: number): number {
  if (z === 0) return 0.5
  const absolute = Math.abs(z)
  const t = 1 / (1 + 0.2316419 * absolute)
  const density = Math.exp(-absolute * absolute / 2) / Math.sqrt(2 * Math.PI)
  const upper = density * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return z < 0 ? upper : 1 - upper
}

const numberFormat = new Intl.NumberFormat('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })
const tailFormat = new Intl.NumberFormat('es-EC', { minimumSignificantDigits: 2, maximumSignificantDigits: 2, useGrouping: false })
const upperTailFormat = new Intl.NumberFormat('es-EC', { minimumFractionDigits: 5, maximumFractionDigits: 5, useGrouping: false })

export function formatGrowthValues(z: number, percentile: number | null): string {
  const signedZ = z < 0 ? `−${numberFormat.format(-z)}` : `+${numberFormat.format(z)}`
  if (percentile === null) return `Z ${signedZ} · percentil ${z < 0 ? '<0,00001' : '>99,99999'}`
  let percentileValue = numberFormat.format(percentile)
  if (percentile < 0.01) percentileValue = tailFormat.format(percentile)
  if (percentile > 99.99) percentileValue = upperTailFormat.format(percentile)
  return `Z ${signedZ} · percentil ${percentileValue}`
}

export function calculateGrowth(input: GrowthMeasurementInput, selectedReference: ReferenceSelection | { unavailableReason: string }): GrowthResult {
  const unavailable = (reason: string): GrowthResult => ({ status: 'unavailable', reason })
  if ('unavailableReason' in selectedReference) return unavailable(selectedReference.unavailableReason)
  const ref = selectedReference
  const fifthBirthday = new Date(Date.UTC(ref.birthDate.getUTCFullYear() + 5, ref.birthDate.getUTCMonth(), ref.birthDate.getUTCDate()))
  const measurementDay = new Intl.DateTimeFormat('en-CA', { timeZone: ref.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ref.measuredAt)
  const year = Number(measurementDay.find(part => part.type === 'year')?.value)
  const month = Number(measurementDay.find(part => part.type === 'month')?.value)
  const day = Number(measurementDay.find(part => part.type === 'day')?.value)
  if (!Number.isFinite(fifthBirthday.getTime()) || !Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)
    || Date.UTC(year, month - 1, day) >= fifthBirthday.getTime()) return unavailable('WHO 2007 reference unavailable')
  if (ref.standard !== 'WHO_2006' || !ref.version || !ref.sourceUrl || !ref.publicationDate || !/^[a-f0-9]{64}$/.test(ref.sha256)
    || !/^[a-f0-9]{64}$/.test(ref.datasetId) || !Object.values(Gender).includes(ref.sex) || input.sex !== ref.sex
    || !Object.values(WhoIndicator).includes(ref.indicator)
    || !Number.isFinite(ref.chronologicalAgeDays) || ref.chronologicalAgeDays < 0 || ref.chronologicalAgeDays >= 1827
    || !Number.isFinite(ref.referenceAgeDays) || ref.referenceAgeDays < 0 || ref.referenceAgeDays > 1856
    || !Number.isFinite(ref.lms.l) || !Number.isFinite(ref.lms.m) || !Number.isFinite(ref.lms.s)
    || ref.lms.m <= 0 || ref.lms.s <= 0 || input.lengthHeightCm !== ref.measuredLengthHeightCm
    || !Number.isFinite(ref.adjustedLengthHeightCm) || ref.adjustedLengthHeightCm <= 0
    || Math.abs(ref.adjustedLengthHeightCm - ref.measuredLengthHeightCm - ref.adjustmentCm) > 1e-7
    || (ref.xUnit === 'DAY' && ref.x !== ref.referenceAgeDays)
    || (ref.xUnit === 'CM' && Math.abs(ref.x - ref.adjustedLengthHeightCm) > 1e-7)
    || (ref.indicator === WhoIndicator.WEIGHT_FOR_LENGTH && (ref.referencePosition !== 'RECUMBENT' || ref.xUnit !== 'CM' || ref.referenceAgeDays > 730))
    || (ref.indicator === WhoIndicator.WEIGHT_FOR_HEIGHT && (ref.referencePosition !== 'STANDING' || ref.xUnit !== 'CM' || ref.referenceAgeDays <= 730))
    || (ref.indicator !== WhoIndicator.WEIGHT_FOR_LENGTH && ref.indicator !== WhoIndicator.WEIGHT_FOR_HEIGHT && ref.xUnit !== 'DAY')
    || (ref.indicator === WhoIndicator.HEIGHT_FOR_AGE && ref.referencePosition !== (ref.referenceAgeDays <= 730 ? 'RECUMBENT' : 'STANDING')))
    return unavailable('WHO reference unavailable')

  const ageMonths = Math.min(ref.referenceAgeDays / 30.4375, 59.999)
  let value: number | undefined = input.weightKg
  if (ref.indicator === WhoIndicator.HEIGHT_FOR_AGE) value = ref.adjustedLengthHeightCm
  if (ref.indicator === WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE) value = input.headCircumferenceCm
  if (ref.indicator === WhoIndicator.BMI_FOR_AGE) value = bmi(input.weightKg ?? NaN, ref.adjustedLengthHeightCm)
  if (value === undefined || !Number.isFinite(value) || value <= 0) return unavailable('Invalid measurement')
  const z = correctZ({ value, ...ref.lms })
  if (!Number.isFinite(z)) return unavailable('Invalid growth result')
  const percentileValue = normalCdf(z) * 100
  const percentile = percentileValue < 0.00001 || percentileValue > 99.99999 ? null : percentileValue
  const { datasetId, standard, version, publicationDate, sourceUrl, sha256, ageBasis, chronologicalAgeDays, referenceAgeDays,
    x, xUnit, adjustmentCm, referencePosition, position, gestationDays, prematurityDays } = ref
  return Object.freeze({ status: 'available', indicator: ref.indicator, sex: ref.sex, z, percentile,
    classification: Object.freeze(classify(ref.indicator, z, ageMonths)),
    reference: Object.freeze({ datasetId, standard, version, publicationDate, sourceUrl, sha256, ageBasis, chronologicalAgeDays,
      referenceAgeDays, x, xUnit, adjustmentCm, referencePosition, position, gestationDays, prematurityDays }) })
}
