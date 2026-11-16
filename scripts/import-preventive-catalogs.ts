import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import manifest from './preventive-catalog-manifest.json' with { type: 'json' }

if (process.argv[2] !== 'verify') throw new Error('Only source verification is available; clinical seed is blocked pending reconciliation, rights and pediatrician review')
for (const source of manifest.sources) {
  const filename = source.url.split('/').at(-1)
  const local = source.title.startsWith('Manual') ? 'msp-immunization-manual-2026.pdf' : 'msp-vaccination-schedule-2026.pdf'
  if (!filename || !source.url.startsWith('https://www.salud.gob.ec/wp-content/uploads/2026/')) throw new Error('Unexpected MSP source URL')
  const bytes = await readFile(resolve('docs/clinical/sources', local))
  if (bytes.length !== source.bytes || createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error(`MSP source mismatch: ${local}`)
  process.stdout.write(`${source.title}: ${source.sha256} (${bytes.length} bytes); content NOT reconciled\n`)
}
