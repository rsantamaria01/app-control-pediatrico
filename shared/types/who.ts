import type { Gender, WhoIndicator } from '../utils/enums'

export type DatasetId = string & { readonly __datasetId: unique symbol }
export type WhoPosition = 'RECUMBENT' | 'STANDING' | null
export type WhoXUnit = 'DAY' | 'CM'

export interface VerifiedSource {
  publisher: 'WHO'
  standard: 'WHO_2006'
  version: string
  publicationDate: string
  retrievedAt: string
  url: string
  sha256: string
  bytes: Uint8Array
  indicator: WhoIndicator
  sex: Gender
  position: WhoPosition
  xUnit: WhoXUnit
  minX: number
  maxX: number
  step: number
}

export interface WhoRow {
  indicator: WhoIndicator
  sex: Gender
  position: WhoPosition
  xUnit: WhoXUnit
  x: number
  l: number
  m: number
  s: number
  sdNeg3: number
  sdNeg2: number
  sdNeg1: number
  sd0: number
  sd1: number
  sd2: number
  sd3: number
}
