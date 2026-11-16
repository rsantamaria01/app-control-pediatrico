import { createHash, randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { isIP } from 'node:net'
import type { CatalogEntry, CatalogKind, CatalogRow, CatalogVersion, CatalogView, DoctorMilestone, DoctorMilestoneInput, OfficialCatalogSource, SourceFile } from '../../shared/types/catalog'
import { aapProvenance, catalogKinds, doctorMilestoneSchema, draftBadge, draftStatus } from '../../shared/types/catalog'
import type { Actor } from '../../shared/types/access'
import { catalogItem, catalogRelease, doctorCatalogEntry } from '../db/schema'
import { useDb } from '../utils/db'

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}

function verifyFile(file: SourceFile): void {
  const url = /^https:\/\//.test(file.url) ? new URL(file.url) : null
  if (!file.file?.trim() || !url || url.username || url.password || url.port || isIP(url.hostname)
    || !['who.int', 'cdc.gov', 'aap.org', 'salud.gob.ec'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))
    || !/^[a-f0-9]{64}$/.test(file.sha256) || !(file.bytes instanceof Uint8Array) || !file.bytes.length) throw new Error('Invalid catalog source metadata')
  if (createHash('sha256').update(file.bytes).digest('hex') !== file.sha256) throw new Error('Catalog source hash mismatch')
}

export function validateDraftCatalog(source: OfficialCatalogSource, entries: CatalogEntry[]): { source: OfficialCatalogSource, entries: CatalogRow[] } {
  if (!catalogKinds.includes(source.kind) || !source.publisher?.trim() || !source.title?.trim() || !source.version?.trim()
    || (source.publicationDate !== null && !validDate(source.publicationDate)) || !validDate(source.retrievedAt)) throw new Error('Invalid catalog source metadata')
  const files = [{ file: source.sourceFile || source.url.split('/').at(-1) || '', url: source.url, sha256: source.sha256, bytes: source.bytes }, ...(source.additionalSources || [])]
  files.forEach(verifyFile)
  if (new Set(files.map(file => file.file)).size !== files.length) throw new Error('Duplicate source file')
  if (source.kind === 'VACCINE' && (files.length < 2 || files.some(file => !file.url.includes('salud.gob.ec')))) throw new Error('Vaccine requires MSP schedule and manual')
  if (!entries.length) throw new Error('Catalog requires sourced entries')
  const keys = new Set<string>()
  const rows = entries.map((entry) => {
    if (Object.keys(entry).some(key => !['key', 'label', 'domain', 'minAgeMonths', 'maxAgeMonths', 'minAgeDays', 'maxAgeDays', 'sourcePage', 'sourcePages', 'doseNumber', 'recommendedAge', 'minimumInterval', 'provenance'].includes(key))
      || !entry.key?.trim() || !entry.label?.trim() || !entry.domain?.trim()
      || !Number.isFinite(entry.minAgeMonths) || !Number.isFinite(entry.maxAgeMonths) || entry.minAgeMonths < 0 || entry.maxAgeMonths < entry.minAgeMonths
      || keys.has(entry.key)) throw new Error('Invalid or duplicate catalog entry')
    if ((entry.minAgeDays !== undefined || entry.maxAgeDays !== undefined) && (!Number.isInteger(entry.minAgeDays) || !Number.isInteger(entry.maxAgeDays) || entry.minAgeDays! < 0 || entry.maxAgeDays! < entry.minAgeDays!)) throw new Error('Invalid day range')
    if (entry.sourcePages) {
      if (!entry.sourcePages.length || entry.sourcePages.some(page => !files.some(file => file.file === page.file) || !Number.isInteger(page.page) || page.page < 1)) throw new Error('Invalid source pages')
    } else if (!entry.sourcePage?.trim()) throw new Error('Missing source page')
    if (source.kind === 'CHECKUP' && (source.publisher !== 'AAP' || entry.provenance !== aapProvenance || entry.domain !== 'Control por edad')) throw new Error('AAP checkups must be age-only facts with provenance')
    if (source.kind === 'VACCINE' && (!entry.sourcePages || files.some(file => !entry.sourcePages!.some(page => page.file === file.file))
      || !Number.isInteger(entry.doseNumber) || (entry.doseNumber || 0) < 1 || !entry.recommendedAge?.trim()
      || entry.minimumInterval === undefined || (entry.minimumInterval !== null && !entry.minimumInterval.trim()))) throw new Error('Vaccine dose requires both sources and interval evidence')
    keys.add(entry.key)
    return { ...entry, status: draftStatus, badge: draftBadge }
  })
  return { source, entries: rows }
}

export async function importDraftCatalog(input: OfficialCatalogSource, entries: CatalogEntry[]): Promise<CatalogVersion> {
  const validated = validateDraftCatalog(input, entries)
  const sources = [{ file: input.sourceFile || input.url.split('/').at(-1) || '', url: input.url, sha256: input.sha256 }, ...(input.additionalSources || []).map(({ file, url, sha256 }) => ({ file, url, sha256 }))]
  const id = createHash('sha256').update([input.kind, input.publisher, input.version, input.url, input.sha256, JSON.stringify(sources), JSON.stringify(entries)].join('|')).digest('hex')
  const db = useDb()
  const existing = await db.select({ id: catalogRelease.id }).from(catalogRelease).where(eq(catalogRelease.id, id))
  if (existing.length) return (await getCatalogView(input.kind)).versions.find(version => version.id === id)!
  await db.transaction(async (tx) => {
    await tx.insert(catalogRelease).values({ id, kind: input.kind, publisher: input.publisher, title: input.title, version: input.version,
      publicationDate: input.publicationDate, retrievedAt: input.retrievedAt, url: input.url, sha256: input.sha256, sources, status: draftStatus })
    await tx.insert(catalogItem).values(validated.entries.map(row => ({ releaseId: id, key: row.key, label: row.label,
      domain: row.domain, minAgeMonths: String(row.minAgeMonths), maxAgeMonths: String(row.maxAgeMonths), sourcePage: row.sourcePage || row.sourcePages?.map(page => `${page.file} p. ${page.page}`).join('; ') || '',
      sourcePages: row.sourcePages, minAgeDays: row.minAgeDays === undefined ? null : String(row.minAgeDays), maxAgeDays: row.maxAgeDays === undefined ? null : String(row.maxAgeDays), doseNumber: row.doseNumber === undefined ? null : String(row.doseNumber), recommendedAge: row.recommendedAge, minimumInterval: row.minimumInterval, provenance: row.provenance, status: draftStatus })))
  })
  const view = await getCatalogView(input.kind)
  return view.versions.find(version => version.id === id)!
}

export async function getCatalogView(kind: CatalogKind, includeDoctorEntries = false): Promise<CatalogView> {
  if (!catalogKinds.includes(kind)) throw new Error('Invalid catalog kind')
  const db = useDb()
  const releases = await db.select().from(catalogRelease).where(eq(catalogRelease.kind, kind)).orderBy(desc(catalogRelease.importedAt), desc(catalogRelease.id))
  const versions: CatalogVersion[] = []
  for (const release of releases) {
    const items = await db.select().from(catalogItem).where(eq(catalogItem.releaseId, release.id)).orderBy(catalogItem.key)
    if (release.status !== draftStatus || items.some(row => row.status !== draftStatus)) throw new Error('Unapproved catalog status')
    versions.push({ id: release.id, kind, publisher: release.publisher, title: release.title, version: release.version, publicationDate: release.publicationDate,
      retrievedAt: release.retrievedAt, url: release.url, sha256: release.sha256, sources: release.sources || [{ file: release.url.split('/').at(-1) || '', url: release.url, sha256: release.sha256 }], status: draftStatus, importedAt: release.importedAt.toISOString(),
      entries: items.map(row => ({ key: row.key, label: row.label, domain: row.domain, minAgeMonths: Number(row.minAgeMonths), maxAgeMonths: Number(row.maxAgeMonths), sourcePage: row.sourcePage,
        ...(row.sourcePages && { sourcePages: row.sourcePages }), ...(row.minAgeDays !== null && { minAgeDays: Number(row.minAgeDays), maxAgeDays: Number(row.maxAgeDays) }), ...(row.doseNumber !== null && { doseNumber: Number(row.doseNumber) }), ...(row.recommendedAge && { recommendedAge: row.recommendedAge }),
        ...(row.sourcePages && { minimumInterval: row.minimumInterval }), ...(row.provenance && { provenance: row.provenance }), status: draftStatus, badge: draftBadge })) })
  }
  if (kind !== 'MILESTONE' || !includeDoctorEntries) return { kind, versions }
  const doctorRows = await db.select().from(doctorCatalogEntry).orderBy(desc(doctorCatalogEntry.createdAt))
  return { kind, versions, doctorEntries: doctorRows.map(row => ({ id: row.id, label: row.label, domain: row.domain,
    minAgeMonths: Number(row.minAgeMonths), maxAgeMonths: Number(row.maxAgeMonths), source: row.source, createdAt: row.createdAt.toISOString(), badge: draftBadge, status: draftStatus })) }
}

export async function addDoctorMilestone(actor: Actor, raw: DoctorMilestoneInput): Promise<DoctorMilestone> {
  if (!actor.roles.includes('DOCTOR')) throw new Error('Doctor access required')
  const input = doctorMilestoneSchema.parse(raw)
  const id = randomUUID()
  const [row] = await useDb().insert(doctorCatalogEntry).values({ id, authorId: actor.id, label: input.label, domain: input.domain,
    minAgeMonths: String(input.minAgeMonths), maxAgeMonths: String(input.maxAgeMonths), source: input.source }).returning()
  return { ...input, id, createdAt: row!.createdAt.toISOString(), badge: draftBadge, status: draftStatus }
}
