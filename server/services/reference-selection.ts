import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import manifest from '../../scripts/who-2006-manifest.json' with { type: 'json' }
import type { DatasetId, WhoXUnit } from '../../shared/types/who'
import { Gender, WhoIndicator } from '../../shared/utils/enums'
import { lookupLms } from '../../shared/utils/zscore'
import { whoDataset } from '../db/schema'
import { getWhoRows } from './who-import'

const dayMs = 86400000

type Position = 'RECUMBENT' | 'STANDING'

type ReferenceInput = {
  birthDate: Date
  measuredAt: Date
  gestationDays?: number
  correctionUntilMonths?: 24 | 36
  timeZone?: string
  measuredLengthHeightCm: number
  position: Position
  indicator: WhoIndicator
  sex: Gender
}

export type ReferenceSelection = {
  datasetId: DatasetId
  standard: 'WHO_2006'
  version: string
  publicationDate: string
  sourceUrl: string
  sha256: string
  indicator: WhoIndicator
  sex: Gender
  birthDate: Date
  measuredAt: Date
  measuredLengthHeightCm: number
  position: Position
  adjustedLengthHeightCm: number
  adjustmentCm: number
  referencePosition: Position | null
  ageBasis: 'CORRECTED' | 'CHRONOLOGICAL'
  chronologicalAgeDays: number
  referenceAgeDays: number
  gestationDays: number | null
  prematurityDays: number
  correctionUntilMonths: 24 | 36
  timeZone: string
  xUnit: WhoXUnit
  x: number
  lms: { l: number, m: number, s: number }
}

function calendarDay(date: Date, formatter: Intl.DateTimeFormat): number {
  const parts = formatter.formatToParts(date)
  const year = Number(parts.find(part => part.type === 'year')!.value)
  const month = Number(parts.find(part => part.type === 'month')!.value)
  const day = Number(parts.find(part => part.type === 'day')!.value)
  return Date.UTC(year, month - 1, day)
}

function anniversary(date: Date, months: number): Date {
  const year = date.getUTCFullYear() + Math.floor((date.getUTCMonth() + months) / 12)
  const month = (date.getUTCMonth() + months) % 12
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)))
}

export async function selectReference(input: ReferenceInput): Promise<ReferenceSelection | { unavailableReason: string }> {
  const unavailable = (unavailableReason: string) => ({ unavailableReason })
  const { birthDate, measuredAt, gestationDays, correctionUntilMonths = 24, timeZone = 'America/Guayaquil', measuredLengthHeightCm, position, indicator, sex } = input
  if (!(birthDate instanceof Date) || !(measuredAt instanceof Date) || !Number.isFinite(birthDate.getTime()) || !Number.isFinite(measuredAt.getTime())
    || birthDate.getTime() % dayMs !== 0
    || !Number.isFinite(measuredLengthHeightCm) || measuredLengthHeightCm <= 0
    || !Object.values(Gender).includes(sex) || !Object.values(WhoIndicator).includes(indicator)
    || (position !== 'RECUMBENT' && position !== 'STANDING')
    || (correctionUntilMonths !== 24 && correctionUntilMonths !== 36)
    || (gestationDays !== undefined && (!Number.isInteger(gestationDays) || gestationDays <= 0 || gestationDays > 280))
    || (correctionUntilMonths === 36 && (gestationDays === undefined || gestationDays >= 196))
    || typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > 128) return unavailable('Invalid reference input')

  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch (error) {
    if (error instanceof RangeError) return unavailable('Invalid reference input')
    throw error
  }
  const birthDay = Date.UTC(birthDate.getUTCFullYear(), birthDate.getUTCMonth(), birthDate.getUTCDate())
  const measurementDay = calendarDay(measuredAt, formatter)
  if (measurementDay < birthDay) return unavailable('Invalid reference input')
  const chronologicalAgeDays = (measurementDay - birthDay) / dayMs
  if (measurementDay >= anniversary(birthDate, 60).getTime() || chronologicalAgeDays > 1856) return unavailable('WHO 2007 reference unavailable')
  const prematurityDays = gestationDays === undefined || gestationDays >= 259 ? 0 : 280 - gestationDays
  const isCorrected = prematurityDays > 0 && measurementDay <= anniversary(birthDate, correctionUntilMonths).getTime()
  const referenceAgeDays = chronologicalAgeDays - (isCorrected ? prematurityDays : 0)
  if (referenceAgeDays < 0 || referenceAgeDays > 1856) return unavailable('Age outside WHO 2006 range')

  const referencePosition: Position = referenceAgeDays <= 730 ? 'RECUMBENT' : 'STANDING'
  if ((indicator === WhoIndicator.WEIGHT_FOR_LENGTH && referencePosition !== 'RECUMBENT')
    || (indicator === WhoIndicator.WEIGHT_FOR_HEIGHT && referencePosition !== 'STANDING')) return unavailable('Indicator outside position range')
  const adjustmentCm = position === referencePosition ? 0 : position === 'STANDING' ? 0.7 : -0.7
  const adjustedLengthHeightCm = Math.round((measuredLengthHeightCm + adjustmentCm) * 1e10) / 1e10
  const xUnit: WhoXUnit = indicator === WhoIndicator.WEIGHT_FOR_LENGTH || indicator === WhoIndicator.WEIGHT_FOR_HEIGHT ? 'CM' : 'DAY'
  const x = xUnit === 'CM' ? adjustedLengthHeightCm : referenceAgeDays
  const minX = xUnit === 'DAY' ? 0 : indicator === WhoIndicator.WEIGHT_FOR_LENGTH ? 45 : 65
  const maxX = xUnit === 'DAY' ? 1856 : indicator === WhoIndicator.WEIGHT_FOR_LENGTH ? 110 : 120
  if (x < minX || x > maxX) return unavailable('Outside WHO reference range')

  if (!process.env.DATABASE_URL) return unavailable('WHO reference unavailable')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const db = drizzle(pool)
    const [dataset] = await db.select().from(whoDataset).where(and(eq(whoDataset.version, manifest.version), eq(whoDataset.indicator, indicator), eq(whoDataset.sex, sex)))
    const file = manifest.files.find(file => file.indicator === indicator && file.sex === sex)
    if (!dataset || !file || !dataset.sealed || dataset.standard !== 'WHO_2006' || dataset.publisher !== 'WHO'
      || dataset.sha256 !== file.sha256 || dataset.sourceUrl !== file.url || dataset.publicationDate !== file.publicationDate
      || dataset.retrievedAt !== manifest.retrievedAt || dataset.xUnit !== xUnit
      || dataset.position !== (xUnit === 'CM' ? referencePosition : null)
      || Number(dataset.minX) !== minX || Number(dataset.maxX) !== maxX) return unavailable('WHO reference unavailable')
    const rowPosition = indicator === WhoIndicator.HEIGHT_FOR_AGE || xUnit === 'CM' ? referencePosition : null
    const rows = await getWhoRows(dataset.id as DatasetId, indicator, sex, rowPosition)
    const lms = lookupLms(rows.map(row => ({ indicator: row.indicator, gender: row.sex, xValue: row.x, l: row.l, m: row.m, s: row.s })), indicator, sex, x)
    if (!lms) return unavailable('WHO reference unavailable')
    return {
      datasetId: dataset.id as DatasetId, standard: 'WHO_2006', version: dataset.version,
      publicationDate: dataset.publicationDate, sourceUrl: dataset.sourceUrl, sha256: dataset.sha256,
      indicator, sex, birthDate: new Date(birthDate), measuredAt: new Date(measuredAt), measuredLengthHeightCm,
      position, adjustedLengthHeightCm, adjustmentCm, referencePosition: rowPosition,
      ageBasis: isCorrected ? 'CORRECTED' : 'CHRONOLOGICAL', chronologicalAgeDays, referenceAgeDays,
      gestationDays: gestationDays ?? null, prematurityDays, correctionUntilMonths, timeZone, xUnit, x, lms
    }
  } finally {
    await pool.end()
  }
}
