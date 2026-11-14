import type { ReferenceSelection } from '../../server/services/reference-selection'
import type { ClinicalLabel } from '../utils/clinical-labels'
import type { Gender, WhoIndicator } from '../utils/enums'

export type MeasurementInput = {
  weightKg?: number
  lengthHeightCm?: number
  headCircumferenceCm?: number
  sex: Gender
}

type GrowthProvenance = Readonly<Pick<ReferenceSelection, 'datasetId' | 'standard' | 'version' | 'publicationDate' | 'sourceUrl' | 'sha256' | 'ageBasis' | 'chronologicalAgeDays' | 'referenceAgeDays' | 'x' | 'xUnit' | 'adjustmentCm' | 'referencePosition' | 'position' | 'gestationDays' | 'prematurityDays'>>

export type GrowthResult = { status: 'unavailable', reason: string } | {
  status: 'available'
  indicator: WhoIndicator
  sex: Gender
  z: number
  percentile: number
  classification: ClinicalLabel
  reference: GrowthProvenance
}
