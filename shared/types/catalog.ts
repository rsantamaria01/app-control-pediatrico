export const catalogKinds = ['MOTOR', 'MILESTONE', 'SCREENING', 'CHECKUP', 'VACCINE'] as const
export type CatalogKind = typeof catalogKinds[number]
export const draftStatus = 'DRAFT_PENDING_PEDIATRICIAN_REVIEW' as const
export const draftBadge = 'Borrador · pendiente de revisión pediátrica' as const

export type OfficialCatalogSource = {
  kind: CatalogKind
  publisher: string
  title: string
  version: string
  publicationDate: string
  retrievedAt: string
  url: string
  sha256: string
  bytes: Uint8Array
}

export type CatalogEntry = {
  key: string
  label: string
  domain: string
  minAgeMonths: number
  maxAgeMonths: number
  sourcePage: string
}

export type CatalogRow = CatalogEntry & { status: typeof draftStatus, badge: typeof draftBadge }
export type CatalogVersion = {
  id: string
  kind: CatalogKind
  publisher: string
  title: string
  version: string
  publicationDate: string
  retrievedAt: string
  url: string
  sha256: string
  status: typeof draftStatus
  importedAt: string
  entries: CatalogRow[]
}
export type CatalogView = { kind: CatalogKind, versions: CatalogVersion[] }
