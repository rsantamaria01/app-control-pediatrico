import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { parseWhoWorkbook, importWhoDataset } from '../server/services/who-import.ts'
import { WhoIndicator } from '../shared/utils/enums.ts'
import type { Gender } from '../shared/utils/enums'
import type { VerifiedSource } from '../shared/types/who'
import manifest from './who-2006-manifest.json' with { type: 'json' }

const directory = resolve(process.env.WHO_SOURCE_DIR || '/tmp/opencode/who-2006')
if (process.argv[2] === 'import' && (!process.env.DATABASE_URL || (new URL(process.env.DATABASE_URL).pathname === '/pediatrico' && process.env.WHO_ALLOW_CLINICAL_IMPORT !== 'yes'))) {
  throw new Error('Explicit WHO_ALLOW_CLINICAL_IMPORT=yes required for clinical database')
}
if (!['download', 'import'].includes(process.argv[2] || '')) throw new Error('Usage: node --experimental-strip-types scripts/import-who.ts download|import')
await mkdir(directory, { recursive: true })
for (const file of manifest.files) {
  const path = resolve(directory, `${file.name}-expanded.xlsx`)
  let bytes: Uint8Array
  if (process.argv[2] === 'download') {
    const response = await fetch(file.url)
    if (!response.ok || !response.url.startsWith('https://cdn.who.int/')) throw new Error(`WHO download failed: ${file.name}`)
    bytes = new Uint8Array(await response.arrayBuffer())
  } else bytes = await readFile(path)
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`WHO source hash mismatch: ${file.name}`)
  if (process.argv[2] === 'download') {
    await writeFile(path, bytes)
    continue
  }
  const indicator = file.indicator as WhoIndicator
  const sex = file.sex as Gender
  const isLength = indicator === WhoIndicator.WEIGHT_FOR_LENGTH
  const isHeight = indicator === WhoIndicator.WEIGHT_FOR_HEIGHT
  const source: VerifiedSource = {
    publisher: 'WHO', standard: 'WHO_2006', version: manifest.version,
    publicationDate: file.publicationDate, retrievedAt: manifest.retrievedAt,
    url: file.url, sha256: file.sha256, bytes, indicator, sex,
    position: isLength ? 'RECUMBENT' : isHeight ? 'STANDING' : null,
    xUnit: isLength || isHeight ? 'CM' : 'DAY',
    minX: isLength ? 45 : isHeight ? 65 : 0,
    maxX: isLength ? 110 : isHeight ? 120 : 1856,
    step: isLength || isHeight ? 0.1 : 1
  }
  const rows = await parseWhoWorkbook(source, bytes)
  const id = await importWhoDataset(source, rows)
  process.stdout.write(`${file.name}: ${rows.length} rows, ${id}\n`)
}
