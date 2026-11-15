import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { Pool } from 'pg'
import manifest from './who-2006-manifest.json' with { type: 'json' }
import { importWhoRelease, parseWhoWorkbook } from '../server/services/who-import.ts'
import { WhoIndicator } from '../shared/utils/enums.ts'
import type { Gender } from '../shared/utils/enums.ts'
import type { VerifiedSource } from '../shared/types/who.ts'

if (process.env.WHO_ALLOW_CLINICAL_IMPORT || !/^pediatrico_alpha_[a-f0-9]{12}_test$/.test(process.env.DB_NAME || '') || !process.env.DB_PASSWORD || process.env.DB_HOST !== 'db') throw new Error('Disposable checkpoint database required; clinical WHO import remains gated')
const url = new URL(`postgres://pediatrico@db:5432/${process.env.DB_NAME}`)
url.password = process.env.DB_PASSWORD
const db = new Pool({ connectionString: url.href })
try {
  const before = await db.query('SELECT count(*)::int AS n FROM who_dataset')
  if (before.rows[0]?.n !== 0) throw new Error('WHO fixture requires an empty disposable database')
  const entries = await Promise.all(manifest.files.map(async (file) => {
    const bytes = await readFile(resolve('/tmp/opencode/who-2006', `${file.name}-expanded.xlsx`))
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`Pinned WHO checksum mismatch: ${file.name}`)
    const indicator = file.indicator as WhoIndicator
    const isLength = indicator === WhoIndicator.WEIGHT_FOR_LENGTH
    const isHeight = indicator === WhoIndicator.WEIGHT_FOR_HEIGHT
    const source: VerifiedSource = {
      publisher: 'WHO', standard: 'WHO_2006', version: manifest.version, publicationDate: file.publicationDate,
      retrievedAt: manifest.retrievedAt, url: file.url, sha256: file.sha256, bytes, indicator, sex: file.sex as Gender,
      position: isLength ? 'RECUMBENT' : isHeight ? 'STANDING' : null, xUnit: isLength || isHeight ? 'CM' : 'DAY',
      minX: isLength ? 45 : isHeight ? 65 : 0, maxX: isLength ? 110 : isHeight ? 120 : 1856, step: isLength || isHeight ? 0.1 : 1
    }
    return { source, rows: await parseWhoWorkbook(source, bytes) }
  }))
  process.env.DATABASE_URL = url.href
  await importWhoRelease(entries)
  const after = await db.query('SELECT count(*)::int AS n FROM who_reference_row')
  if (after.rows[0]?.n !== 17260) throw new Error('Incomplete WHO fixture')
  process.stdout.write('Verified WHO checkpoint fixture: 12 sealed datasets, 17260 rows in disposable database\n')
} finally {
  await db.end()
}
