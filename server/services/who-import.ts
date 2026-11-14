import { createHash } from 'node:crypto'
import ExcelJS from 'exceljs'
import { and, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { Gender, WhoIndicator } from '../../shared/utils/enums.ts'
import type { DatasetId, VerifiedSource, WhoPosition, WhoRow, WhoXUnit } from '../../shared/types/who'
import { whoDataset, whoReferenceRow } from '../db/schema.ts'
import manifest from '../../scripts/who-2006-manifest.json' with { type: 'json' }

const specs: Record<WhoIndicator, { unit: WhoXUnit, position: WhoPosition | 'SPLIT', min: number, max: number, step: number }> = {
  [WhoIndicator.WEIGHT_FOR_AGE]: { unit: 'DAY', position: null, min: 0, max: 1856, step: 1 },
  [WhoIndicator.HEIGHT_FOR_AGE]: { unit: 'DAY', position: 'SPLIT', min: 0, max: 1856, step: 1 },
  [WhoIndicator.WEIGHT_FOR_LENGTH]: { unit: 'CM', position: 'RECUMBENT', min: 45, max: 110, step: 0.1 },
  [WhoIndicator.WEIGHT_FOR_HEIGHT]: { unit: 'CM', position: 'STANDING', min: 65, max: 120, step: 0.1 },
  [WhoIndicator.BMI_FOR_AGE]: { unit: 'DAY', position: null, min: 0, max: 1856, step: 1 },
  [WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE]: { unit: 'DAY', position: null, min: 0, max: 1856, step: 1 }
}

function expectedPosition(indicator: WhoIndicator, x: number): WhoPosition {
  const position = specs[indicator].position
  return position === 'SPLIT' ? (x <= 730 ? 'RECUMBENT' : 'STANDING') : position
}

function dateIsValid(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}

export function validateWhoDataset(source: VerifiedSource, rows: WhoRow[]): WhoRow[] {
  const spec = specs[source.indicator]
  if (source.publisher !== 'WHO' || source.standard !== 'WHO_2006' || !spec
    || !/^WHO_2006_[A-Za-z0-9_-]+$/.test(source.version)
    || !dateIsValid(source.publicationDate) || !dateIsValid(source.retrievedAt)
    || !/^https:\/\/cdn\.who\.int\/media\/docs\/default-source\/child-growth\/child-growth-standards\/indicators\/.+\.xlsx(?:\?sfvrsn=[\w-]+)?$/.test(source.url)
    || !/^[a-f0-9]{64}$/.test(source.sha256)
    || !(source.bytes instanceof Uint8Array)
    || createHash('sha256').update(source.bytes).digest('hex') !== source.sha256
    || !manifest.files.some(file => file.indicator === source.indicator && file.sex === source.sex && file.url === source.url && file.sha256 === source.sha256 && file.publicationDate === source.publicationDate)
    || source.version !== manifest.version || source.retrievedAt !== manifest.retrievedAt
    || !Object.values(Gender).includes(source.sex)
    || source.xUnit !== spec.unit || source.minX !== spec.min || source.maxX !== spec.max || source.step !== spec.step
    || source.position !== (spec.position === 'SPLIT' ? null : spec.position)) throw new Error('Invalid WHO source metadata')
  return validateWhoRows(source, rows)
}

export function validateWhoRows(source: VerifiedSource, rows: WhoRow[]): WhoRow[] {
  const spec = specs[source.indicator]
  if (!spec || !Object.values(Gender).includes(source.sex) || source.xUnit !== spec.unit || source.minX !== spec.min || source.maxX !== spec.max || source.step !== spec.step || source.position !== (spec.position === 'SPLIT' ? null : spec.position)) throw new Error('Invalid WHO row specification')
  const expectedCount = Math.round((spec.max - spec.min) / spec.step) + 1
  if (rows.length !== expectedCount) throw new Error('Incomplete WHO reference range')
  const seen = new Set<number>()
  const fields = ['l', 'm', 's', 'sdNeg3', 'sdNeg2', 'sdNeg1', 'sd0', 'sd1', 'sd2', 'sd3'] as const
  for (const row of rows) {
    if (row.indicator !== source.indicator || row.sex !== source.sex || row.xUnit !== spec.unit
      || !Number.isFinite(row.x) || row.x < spec.min || row.x > spec.max
      || Math.abs(Math.round((row.x - spec.min) / spec.step) * spec.step + spec.min - row.x) > 1e-7
      || row.position !== expectedPosition(row.indicator, row.x) || seen.has(Math.round((row.x - spec.min) / spec.step))
      || fields.some(field => !Number.isFinite(row[field])) || row.m <= 0 || row.s <= 0) throw new Error('Invalid WHO row')
    seen.add(Math.round((row.x - spec.min) / spec.step))
    const sd = [row.sdNeg3, row.sdNeg2, row.sdNeg1, row.sd0, row.sd1, row.sd2, row.sd3]
    if (sd.some((v, i) => v <= 0 || (i > 0 && v <= sd[i - 1]!)) || Math.abs(row.sd0 - row.m) > 0.0011) throw new Error('Invalid WHO SD columns')
  }
  return [...rows].sort((a, b) => a.x - b.x)
}

export async function parseWhoWorkbook(source: VerifiedSource, bytes: Uint8Array): Promise<WhoRow[]> {
  if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error('WHO workbook hash mismatch')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0])
  const sheet = workbook.worksheets[0]
  const headers = sheet?.getRow(1).values
  const expected = [source.xUnit === 'DAY' ? 'Day' : source.position === 'RECUMBENT' ? 'Length' : 'Height', 'L', 'M', 'S', 'SD4neg', 'SD3neg', 'SD2neg', 'SD1neg', 'SD0', 'SD1', 'SD2', 'SD3', 'SD4']
  if (!sheet || !Array.isArray(headers) || expected.some((value, index) => headers[index + 1] !== value)) throw new Error('Unexpected WHO workbook columns')
  const rows: WhoRow[] = []
  for (let index = 2; index <= sheet.rowCount; index++) {
    const values = sheet.getRow(index).values
    if (!Array.isArray(values) || values.length !== 14 || values.slice(1).some(value => typeof value !== 'number')) throw new Error('Incomplete WHO workbook row')
    const x = values[1] as number
    rows.push({ indicator: source.indicator, sex: source.sex, position: expectedPosition(source.indicator, x), xUnit: source.xUnit,
      x, l: values[2] as number, m: values[3] as number, s: values[4] as number,
      sdNeg3: values[6] as number, sdNeg2: values[7] as number, sdNeg1: values[8] as number,
      sd0: values[9] as number, sd1: values[10] as number, sd2: values[11] as number, sd3: values[12] as number })
  }
  return validateWhoDataset(source, rows)
}

function database() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return { pool, db: drizzle(pool) }
}

export async function importWhoDataset(source: VerifiedSource, rows: WhoRow[]): Promise<DatasetId> {
  const ordered = validateWhoDataset(source, rows)
  const original = await parseWhoWorkbook(source, source.bytes)
  if (original.some((row, index) => JSON.stringify(row) !== JSON.stringify(ordered[index]))) throw new Error('WHO rows differ from pinned source workbook')
  const id = createHash('sha256').update([source.standard, source.version, source.indicator, source.sex, source.url, source.sha256].join('|')).digest('hex') as DatasetId
  const { db, pool } = database()
  try {
    await db.transaction(async (tx) => {
      const inserted = await tx.insert(whoDataset).values({ id, publisher: source.publisher, standard: source.standard,
        version: source.version, publicationDate: source.publicationDate, retrievedAt: source.retrievedAt,
        sourceUrl: source.url, sha256: source.sha256, indicator: source.indicator, sex: source.sex,
        position: source.position, xUnit: source.xUnit, minX: String(source.minX), maxX: String(source.maxX),
        rowCount: ordered.length }).onConflictDoNothing().returning({ id: whoDataset.id })
      if (inserted.length === 0) throw new Error('WHO dataset already imported; versions are immutable')
      for (let start = 0; start < ordered.length; start += 250) {
        await tx.insert(whoReferenceRow).values(ordered.slice(start, start + 250).map(row => ({ datasetId: id, ...row, x: String(row.x), l: String(row.l), m: String(row.m), s: String(row.s),
          sdNeg3: String(row.sdNeg3), sdNeg2: String(row.sdNeg2), sdNeg1: String(row.sdNeg1), sd0: String(row.sd0), sd1: String(row.sd1), sd2: String(row.sd2), sd3: String(row.sd3) })))
      }
    })
    return id
  } finally {
    await pool.end()
  }
}

export async function getWhoRows(datasetId: DatasetId, indicator: WhoIndicator, sex: Gender, position: 'RECUMBENT' | 'STANDING' | null): Promise<WhoRow[]> {
  if (!Object.values(WhoIndicator).includes(indicator) || !Object.values(Gender).includes(sex) || (position !== null && position !== 'RECUMBENT' && position !== 'STANDING')) throw new Error('Invalid reference query')
  const { db, pool } = database()
  try {
    const [dataset] = await db.select().from(whoDataset).where(eq(whoDataset.id, datasetId))
    if (!dataset || dataset.standard !== 'WHO_2006' || dataset.indicator !== indicator || dataset.sex !== sex) return []
    const records = await db.select().from(whoReferenceRow).where(and(eq(whoReferenceRow.datasetId, datasetId), eq(whoReferenceRow.indicator, indicator), eq(whoReferenceRow.sex, sex), position === null ? isNull(whoReferenceRow.position) : eq(whoReferenceRow.position, position))).orderBy(whoReferenceRow.x)
    return records.map(row => ({ indicator: row.indicator as WhoIndicator, sex: row.sex as Gender, position: row.position as WhoPosition, xUnit: row.xUnit as WhoXUnit,
      x: Number(row.x), l: Number(row.l), m: Number(row.m), s: Number(row.s), sdNeg3: Number(row.sdNeg3), sdNeg2: Number(row.sdNeg2), sdNeg1: Number(row.sdNeg1),
      sd0: Number(row.sd0), sd1: Number(row.sd1), sd2: Number(row.sd2), sd3: Number(row.sd3) }))
  } finally {
    await pool.end()
  }
}
