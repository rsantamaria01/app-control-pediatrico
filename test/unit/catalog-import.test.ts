import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { validateDraftCatalog } from '../../server/services/catalog-import'
import type { CatalogEntry, OfficialCatalogSource } from '../../shared/types/catalog'

const bytes = new TextEncoder().encode('Official source fixture for tests only')
const source: OfficialCatalogSource = {
  kind: 'MOTOR', publisher: 'WHO', title: 'Test-only source', version: 'test-1', publicationDate: '2026-01-01', retrievedAt: '2026-11-16',
  url: 'https://cdn.who.int/test.pdf', sha256: createHash('sha256').update(bytes).digest('hex'), bytes
}
const entry: CatalogEntry = { key: 'test-window', label: 'Test-only milestone', domain: 'GROSS_MOTOR', minAgeMonths: 3.8, maxAgeMonths: 9.2, sourcePage: '1' }

describe('preventive draft import validation', () => {
  it.each([
    { publisher: '' }, { url: '' }, { url: 'https://other.example/file.pdf' }, { url: 'https://user:pass@cdn.who.int/file.pdf' }, { url: 'https://127.0.0.1/file.pdf' }, { sha256: '' },
    { publicationDate: '' }, { publicationDate: '2026-02-30' }, { retrievedAt: '' }, { version: '' }, { title: '' }, { bytes: new Uint8Array() }
  ])('rejects missing or invalid provenance %j', (change) => {
    expect(() => validateDraftCatalog({ ...source, ...change }, [entry])).toThrow()
  })

  it('rejects a changed original even when the supplied metadata looks valid', () => {
    expect(() => validateDraftCatalog({ ...source, bytes: new TextEncoder().encode('changed') }, [entry])).toThrow('hash')
  })

  it('rejects duplicate identifiers and missing item/page/age evidence', () => {
    for (const rows of [[entry, entry], [{ ...entry, sourcePage: '' }], [{ ...entry, label: '' }], [{ ...entry, minAgeMonths: 10, maxAgeMonths: 9 }], []]) {
      expect(() => validateDraftCatalog(source, rows)).toThrow()
    }
  })

  it('rejects fake vaccine doses when no reconciled manual and schedule evidence exists', () => {
    expect(() => validateDraftCatalog({ ...source, kind: 'VACCINE', publisher: 'MSP', url: 'https://www.salud.gob.ec/test.pdf' }, [entry])).toThrow()
  })

  it('returns independently labelled draft rows without allowing reviewed input', () => {
    const result = validateDraftCatalog(source, [entry])
    expect(result.entries).toEqual([{ ...entry, status: 'DRAFT_PENDING_PEDIATRICIAN_REVIEW', badge: 'Borrador · pendiente de revisión pediátrica' }])
    expect(() => validateDraftCatalog(source, [{ ...entry, status: 'REVIEWED' } as CatalogEntry])).toThrow()
  })
})
