import { z } from 'zod'

export const catalogKinds = ['MOTOR', 'MILESTONE', 'SCREENING', 'CHECKUP', 'VACCINE'] as const
export type CatalogKind = typeof catalogKinds[number]
export const draftStatus = 'DRAFT_PENDING_PEDIATRICIAN_REVIEW' as const
export const draftBadge = 'Borrador - pendiente de revisión' as const
export const aapProvenance = 'AAP Bright Futures periodicity (ages only), pending review' as const

export type SourceFile = { file: string, url: string, sha256: string, bytes: Uint8Array }
export type OfficialCatalogSource = SourceFile & {
  kind: CatalogKind
  publisher: string
  title: string
  version: string
  publicationDate: string | null
  retrievedAt: string
  additionalSources?: SourceFile[]
  sourceFile?: string
}

export type SourcePage = { file: string, page: number }
export type CatalogEntry = {
  key: string
  label: string
  domain: string
  minAgeMonths: number
  maxAgeMonths: number
  sourcePage?: string
  sourcePages?: SourcePage[]
  doseNumber?: number
  recommendedAge?: string
  minimumInterval?: string | null
  provenance?: string
}

export const doctorMilestoneSchema = z.strictObject({
  label: z.string().trim().min(1).max(200),
  domain: z.string().trim().min(1).max(100),
  minAgeMonths: z.number().finite().min(0).max(252),
  maxAgeMonths: z.number().finite().min(0).max(252),
  source: z.string().trim().min(1).max(300)
}).refine(value => value.maxAgeMonths >= value.minAgeMonths, { path: ['maxAgeMonths'], message: 'Edad máxima menor a la mínima' })
export type DoctorMilestoneInput = z.output<typeof doctorMilestoneSchema>
export type DoctorMilestone = DoctorMilestoneInput & { id: string, createdAt: string, badge: typeof draftBadge, status: typeof draftStatus }

export type CatalogRow = CatalogEntry & { status: typeof draftStatus, badge: typeof draftBadge }
export type CatalogVersion = {
  id: string
  kind: CatalogKind
  publisher: string
  title: string
  version: string
  publicationDate: string | null
  retrievedAt: string
  url: string
  sha256: string
  status: typeof draftStatus
  importedAt: string
  sources: Omit<SourceFile, 'bytes'>[]
  entries: CatalogRow[]
}
export type CatalogView = { kind: CatalogKind, versions: CatalogVersion[], doctorEntries?: DoctorMilestone[] }
