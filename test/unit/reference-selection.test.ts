import { describe, expect, it } from 'vitest'
import { Gender, WhoIndicator } from '../../shared/utils/enums'
import { selectReference } from '../../server/services/reference-selection'

const birthDate = new Date('2024-01-01T00:00:00Z')
const input = { birthDate, measuredAt: new Date('2024-01-01T00:00:00Z'), measuredLengthHeightCm: 50, position: 'RECUMBENT' as const, indicator: WhoIndicator.HEIGHT_FOR_AGE, sex: Gender.MALE }

function unavailable(result: Awaited<ReturnType<typeof selectReference>>) {
  expect(result).toHaveProperty('unavailableReason')
}

describe('reference selection input and age limits', () => {
  it('rejects invalid and reversed dates before touching the database', async () => {
    for (const dates of [{ birthDate: new Date('invalid') }, { measuredAt: new Date('2023-12-31T00:00:00Z') }]) unavailable(await selectReference({ ...input, ...dates }))
  })

  it('rejects missing and implausible gestation for explicit extension, and correction before birth', async () => {
    for (const options of [{ correctionUntilMonths: 36 as const }, { gestationDays: 259, correctionUntilMonths: 36 as const }, { gestationDays: 0 }, { gestationDays: 300 }, { gestationDays: 195, correctionUntilMonths: 36 as const }]) unavailable(await selectReference({ ...input, ...options }))
  })

  it('rejects out-of-scope ages even if corrected age would fit WHO 2006', async () => {
    unavailable(await selectReference({ ...input, measuredAt: new Date('2029-02-01T00:00:00Z'), gestationDays: 190 }))
    unavailable(await selectReference({ ...input, measuredAt: new Date('2029-02-01T00:00:00Z') }))
  })

  it('rejects invalid measurements, sex, position and indicator', async () => {
    for (const change of [{ measuredLengthHeightCm: Number.NaN }, { measuredLengthHeightCm: 0 }, { sex: 'OTHER' as Gender }, { position: 'UNKNOWN' as 'STANDING' }, { indicator: 'UNKNOWN' as WhoIndicator }]) unavailable(await selectReference({ ...input, ...change }))
  })
})
