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

  it('accepts an evidenced vaccine dose with separate schedule and manual pages and an unknown interval', () => {
    const manual = new TextEncoder().encode('manual fixture')
    const vaccine = { ...entry, doseNumber: 1, recommendedAge: '2 meses', minimumInterval: null, sourcePages: [
      { file: 'schedule.pdf', page: 1 }, { file: 'manual.pdf', page: 142 }
    ] }
    const input = { ...source, kind: 'VACCINE' as const, publisher: 'MSP', url: 'https://www.salud.gob.ec/test.pdf', sourceFile: 'schedule.pdf',
      additionalSources: [{ file: 'manual.pdf', url: 'https://www.salud.gob.ec/manual.pdf', sha256: createHash('sha256').update(manual).digest('hex'), bytes: manual }] }
    expect(validateDraftCatalog(input, [vaccine]).entries[0]).toMatchObject({ minimumInterval: null, sourcePages: vaccine.sourcePages, badge: 'Borrador - pendiente de revisión' })
    expect(() => validateDraftCatalog(input, [{ ...vaccine, sourcePages: [{ file: 'schedule.pdf', page: 1 }] }])).toThrow()
    expect(() => validateDraftCatalog({ ...input, additionalSources: [{ ...input.additionalSources[0]!, sha256: 'a'.repeat(64) }] }, [vaccine])).toThrow('hash')
  })

  it('accepts unknown publication day without fabricating one and requires evidence on every entry', () => {
    expect(validateDraftCatalog({ ...source, publicationDate: null }, [entry]).source.publicationDate).toBeNull()
    expect(() => validateDraftCatalog(source, [{ ...entry, sourcePage: '' }])).toThrow()
  })

  it('requires schedule and manual pages for each vaccine and exact age-only AAP provenance', () => {
    const extra = new TextEncoder().encode('manual fixture')
    const input = { ...source, kind: 'VACCINE' as const, publisher: 'MSP', url: 'https://www.salud.gob.ec/schedule.pdf', sourceFile: 'schedule.pdf',
      additionalSources: [{ file: 'manual.pdf', url: 'https://www.salud.gob.ec/manual.pdf', bytes: extra, sha256: createHash('sha256').update(extra).digest('hex') }] }
    const row = { ...entry, doseNumber: 1, recommendedAge: '2 meses', minimumInterval: null,
      sourcePages: [{ file: 'schedule.pdf', page: 1 }, { file: 'manual.pdf', page: 142 }] }
    expect(() => validateDraftCatalog(input, [{ ...row, sourcePages: [{ file: 'schedule.pdf', page: 1 }, { file: 'missing.pdf', page: 142 }] }])).toThrow()
    expect(() => validateDraftCatalog(input, [{ ...row, sourcePages: [{ file: 'schedule.pdf', page: 0 }, { file: 'manual.pdf', page: 142 }] }])).toThrow()
    expect(() => validateDraftCatalog(input, [{ ...row, minimumInterval: undefined }])).toThrow()
    expect(() => validateDraftCatalog({ ...source, kind: 'CHECKUP', publisher: 'AAP', url: 'https://downloads.aap.org/schedule.pdf' }, [{ ...entry, provenance: 'Invented' }])).toThrow()
  })

  it('returns independently labelled draft rows without allowing reviewed input', () => {
    const result = validateDraftCatalog(source, [entry])
    expect(result.entries).toEqual([{ ...entry, status: 'DRAFT_PENDING_PEDIATRICIAN_REVIEW', badge: 'Borrador - pendiente de revisión' }])
    expect(() => validateDraftCatalog(source, [{ ...entry, status: 'REVIEWED' } as CatalogEntry])).toThrow()
  })
})
