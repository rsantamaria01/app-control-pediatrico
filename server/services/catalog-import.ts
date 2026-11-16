import { createHash } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { isIP } from 'node:net'
import type { CatalogEntry, CatalogKind, CatalogRow, CatalogVersion, CatalogView, OfficialCatalogSource } from '../../shared/types/catalog'
import { catalogKinds, draftBadge, draftStatus } from '../../shared/types/catalog'
import { catalogItem, catalogRelease } from '../db/schema'
import { useDb } from '../utils/db'

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}

export function validateDraftCatalog(source: OfficialCatalogSource, entries: CatalogEntry[]): { source: OfficialCatalogSource, entries: CatalogRow[] } {
  const url = /^https:\/\//.test(source.url) ? new URL(source.url) : null
  if (!catalogKinds.includes(source.kind) || !source.publisher?.trim() || !source.title?.trim() || !source.version?.trim()
    || !validDate(source.publicationDate) || !validDate(source.retrievedAt)
    || !url || url.username || url.password || url.port || isIP(url.hostname)
    || !['who.int', 'cdc.gov', 'aap.org', 'salud.gob.ec'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))
    || !/^[a-f0-9]{64}$/.test(source.sha256) || !(source.bytes instanceof Uint8Array) || !source.bytes.length) throw new Error('Invalid catalog source metadata')
  if (createHash('sha256').update(source.bytes).digest('hex') !== source.sha256) throw new Error('Catalog source hash mismatch')
  if (source.kind === 'VACCINE') throw new Error('Vaccination seed blocked until MSP schedule and manual are reconciled and reviewed')
  if (!entries.length) throw new Error('Catalog requires sourced entries')
  const keys = new Set<string>()
  const rows = entries.map((entry) => {
    if (Object.keys(entry).some(key => !['key', 'label', 'domain', 'minAgeMonths', 'maxAgeMonths', 'sourcePage'].includes(key))
      || !entry.key?.trim() || !entry.label?.trim() || !entry.domain?.trim() || !entry.sourcePage?.trim()
      || !Number.isFinite(entry.minAgeMonths) || !Number.isFinite(entry.maxAgeMonths) || entry.minAgeMonths < 0 || entry.maxAgeMonths < entry.minAgeMonths
      || keys.has(entry.key)) throw new Error('Invalid or duplicate catalog entry')
    keys.add(entry.key)
    return { ...entry, status: draftStatus, badge: draftBadge }
  })
  return { source, entries: rows }
}

export async function importDraftCatalog(input: OfficialCatalogSource, entries: CatalogEntry[]): Promise<CatalogVersion> {
  const validated = validateDraftCatalog(input, entries)
  const id = createHash('sha256').update([input.kind, input.publisher, input.version, input.url, input.sha256].join('|')).digest('hex')
  const db = useDb()
  await db.transaction(async (tx) => {
    await tx.insert(catalogRelease).values({ id, kind: input.kind, publisher: input.publisher, title: input.title, version: input.version,
      publicationDate: input.publicationDate, retrievedAt: input.retrievedAt, url: input.url, sha256: input.sha256, status: draftStatus })
    await tx.insert(catalogItem).values(validated.entries.map(row => ({ releaseId: id, key: row.key, label: row.label,
      domain: row.domain, minAgeMonths: String(row.minAgeMonths), maxAgeMonths: String(row.maxAgeMonths), sourcePage: row.sourcePage, status: draftStatus })))
  })
  const view = await getCatalogView(input.kind)
  return view.versions.find(version => version.id === id)!
}

export async function getCatalogView(kind: CatalogKind): Promise<CatalogView> {
  if (!catalogKinds.includes(kind)) throw new Error('Invalid catalog kind')
  const db = useDb()
  const releases = await db.select().from(catalogRelease).where(eq(catalogRelease.kind, kind)).orderBy(desc(catalogRelease.importedAt), desc(catalogRelease.id))
  const versions: CatalogVersion[] = []
  for (const release of releases) {
    const items = await db.select().from(catalogItem).where(eq(catalogItem.releaseId, release.id)).orderBy(catalogItem.key)
    if (release.status !== draftStatus || items.some(row => row.status !== draftStatus)) throw new Error('Unapproved catalog status')
    versions.push({ id: release.id, kind, publisher: release.publisher, title: release.title, version: release.version, publicationDate: release.publicationDate,
      retrievedAt: release.retrievedAt, url: release.url, sha256: release.sha256, status: draftStatus, importedAt: release.importedAt.toISOString(),
      entries: items.map(row => ({ key: row.key, label: row.label, domain: row.domain, minAgeMonths: Number(row.minAgeMonths), maxAgeMonths: Number(row.maxAgeMonths), sourcePage: row.sourcePage, status: draftStatus, badge: draftBadge })) })
  }
  return { kind, versions }
}
