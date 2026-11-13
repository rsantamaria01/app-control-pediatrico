import { describe, expect, it } from 'vitest'
import { normalizeUsername, validatePassword, passwordStrength } from '../../server/services/credentials'

describe('credential policy', () => {
  it('stores case-insensitive usernames in lowercase with strict allowed characters', () => {
    expect(normalizeUsername('  Dra.Ana-1  ')).toBe('dra.ana-1')
    for (const value of ['ab', 'name space', 'niño', 'x'.repeat(33), 'a@b']) expect(() => normalizeUsername(value)).toThrow()
  })

  it('accepts long passphrases without composition and rejects common passwords', () => {
    expect(() => validatePassword('password123')).toThrow()
    expect(() => validatePassword('1234567890')).toThrow()
    expect(() => validatePassword('password123456789')).toThrow()
    expect(() => validatePassword('correcthorsebatterystaple')).toThrow()
    expect(() => validatePassword('sunshine1234')).toThrow()
    expect(() => validatePassword('princess123')).toThrow()
    expect(() => validatePassword('letmein12345')).toThrow()
    expect(() => validatePassword('Sunshine1234')).toThrow()
    expect(() => validatePassword('short')).toThrow()
    expect(validatePassword('long ordinary phrase without symbols')).toBe('long ordinary phrase without symbols')
    expect(passwordStrength('long ordinary phrase without symbols')).toBe('Fuerte')
  })
})
