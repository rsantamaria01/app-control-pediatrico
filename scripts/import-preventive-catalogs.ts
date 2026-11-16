import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { importDraftCatalog } from '../server/services/catalog-import'
import { aapProvenance, type CatalogEntry, type OfficialCatalogSource } from '../shared/types/catalog'
import manifest from './preventive-catalog-manifest.json' with { type: 'json' }
import entries from './preventive-catalog-entries.json' with { type: 'json' }

const command = process.argv[2]
if (!['verify', 'import'].includes(command || '')) throw new Error('Usage: pnpm exec tsx scripts/import-preventive-catalogs.ts verify|import')

const sources = await Promise.all(manifest.sources.map(async (source) => {
  const bytes = source.kind === 'CHECKUP'
    ? new Uint8Array(await (await fetch(source.url, { signal: AbortSignal.timeout(30000) })).arrayBuffer())
    : await readFile(resolve('docs/clinical/sources', source.file))
  if (bytes.length !== source.bytes || createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error(`Source mismatch: ${source.file}`)
  process.stdout.write(`${source.file}: ${source.sha256} (${bytes.length} bytes)\n`)
  return { ...source, bytes }
}))

if (command === 'import') {
  const [schedule, manual, aap] = sources
  if (!schedule || !manual || !aap) throw new Error('Missing official source')
  const vaccineSource: OfficialCatalogSource = { ...schedule, kind: 'VACCINE', retrievedAt: manifest.retrievedAt, sourceFile: schedule.file,
    additionalSources: [{ file: manual.file, url: manual.url, sha256: manual.sha256, bytes: manual.bytes }] }
  const vaccineEntries: CatalogEntry[] = entries.vaccine.map(({ manualPage, ...row }) => ({ ...row,
    sourcePages: [{ file: schedule.file, page: 1 }, { file: manual.file, page: manualPage }] }))
  const checkupSource: OfficialCatalogSource = { ...aap, kind: 'CHECKUP', retrievedAt: manifest.retrievedAt, sourceFile: aap.file }
  const checkupEntries: CatalogEntry[] = entries.checkup.map(row => ({ ...row, domain: 'Control por edad', sourcePages: [{ file: aap.file, page: 1 }], provenance: aapProvenance }))
  for (const [source, rows] of [[vaccineSource, vaccineEntries], [checkupSource, checkupEntries]] as const) {
    const release = await importDraftCatalog(source, rows)
    process.stdout.write(`${release.kind}: ${release.id} (${release.entries.length} draft entries)\n`)
  }
  const { useDb } = await import('../server/utils/db')
  await useDb().$client.end()
}
