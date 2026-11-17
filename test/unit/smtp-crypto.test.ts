import { afterEach, describe, expect, it } from 'vitest'
import { decryptSmtpSecret, encryptSmtpSecret } from '../../server/services/smtp-settings'

const previousKey = process.env.SMTP_CONFIG_KEY

afterEach(() => {
  if (previousKey === undefined) delete process.env.SMTP_CONFIG_KEY
  else process.env.SMTP_CONFIG_KEY = previousKey
})

describe('SMTP secret encryption', () => {
  it('round trips without storing the plaintext and uses a fresh nonce', () => {
    process.env.SMTP_CONFIG_KEY = 'a1'.repeat(32)
    const first = encryptSmtpSecret('smtp-passphrase')
    const second = encryptSmtpSecret('smtp-passphrase')
    expect(first).not.toContain('smtp-passphrase')
    expect(first).not.toBe(second)
    expect(decryptSmtpSecret(first)).toBe('smtp-passphrase')
    expect(decryptSmtpSecret(second)).toBe('smtp-passphrase')
  })

  it('refuses encryption and decryption without a valid 256-bit key', () => {
    process.env.SMTP_CONFIG_KEY = 'invalid'
    expect(() => encryptSmtpSecret('smtp-passphrase')).toThrow()
    expect(() => decryptSmtpSecret('v1:bad')).toThrow()
    delete process.env.SMTP_CONFIG_KEY
    expect(() => encryptSmtpSecret('smtp-passphrase')).toThrow()
    expect(() => decryptSmtpSecret('v1:bad')).toThrow()
  })

  it('rejects ciphertext tampering and a different key', () => {
    process.env.SMTP_CONFIG_KEY = 'a1'.repeat(32)
    const encrypted = encryptSmtpSecret('smtp-passphrase')
    const parts = encrypted.split(':')
    parts[parts.length - 1] = parts.at(-1)!.replace(/[a-f0-9]/, value => value === 'a' ? 'b' : 'a')
    expect(() => decryptSmtpSecret(parts.join(':'))).toThrow()
    process.env.SMTP_CONFIG_KEY = 'b2'.repeat(32)
    expect(() => decryptSmtpSecret(encrypted)).toThrow()
  })
})
