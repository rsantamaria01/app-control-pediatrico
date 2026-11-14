import { describe, expect, it } from 'vitest'
import { ecuadorIdSchema, quickPatientSchema, normalizePatientName } from '../../shared/types/patient-registration'

const contact = { name: 'Ana Madre', relationship: 'Madre', phone: '0991234567', email: '' }
const input = { givenNames: 'José', surnames: 'Pérez', birthDate: '2024-01-01', sex: 'MALE', contacts: [contact], confirmPossibleMatches: false }

describe('quick patient registration', () => {
  it('validates Ecuadorian identity with province and modulo-ten check digit', () => {
    expect(ecuadorIdSchema.parse('1710034065')).toBe('1710034065')
    for (const value of ['1710034064', '0010034065', '2510034065', '171003406', '171003406X']) expect(() => ecuadorIdSchema.parse(value)).toThrow()
  })

  it('normalizes accented names for provisional matching', () => {
    expect(normalizePatientName('  José   Pérez ')).toBe('jose perez')
  })

  it('requires representatives and only allows invites with email', () => {
    expect(quickPatientSchema.parse(input).contacts[0]?.phone).toBe('0991234567')
    expect(() => quickPatientSchema.parse({ ...input, contacts: [] })).toThrow()
    expect(() => quickPatientSchema.parse({ ...input, contacts: [{ ...contact, invite: true }] })).toThrow()
    expect(() => quickPatientSchema.parse({ ...input, contacts: [{ ...contact, phone: '123' }] })).toThrow()
    expect(() => quickPatientSchema.parse({ ...input, contacts: [{ ...contact, email: 'invalid' }] })).toThrow()
    expect(() => quickPatientSchema.parse({ ...input, gestationDays: 200 })).toThrow()
  })
})
