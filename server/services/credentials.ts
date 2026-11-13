import { dictionary } from '@zxcvbn-ts/language-common'

const common = new Set<string>(dictionary['passwords-common'].map(value => value.toLowerCase()))
common.add('correcthorsebatterystaple')
common.add('contraseña123')

export function normalizeUsername(value: string) {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-z0-9._-]{3,32}$/.test(normalized)) throw new Error('Usuario inválido')
  return normalized
}

export function validatePassword(value: string) {
  const candidate = value.toLowerCase()
  if (value.length < 10 || value.length > 128 || common.has(candidate) || common.has(candidate.replace(/\d+$/, '')) || /^password\d+$/i.test(value)) throw new Error('Contraseña insegura')
  return value
}

export function passwordStrength(value: string) {
  return value.length >= 24 ? 'Fuerte' : value.length >= 14 ? 'Aceptable' : 'Débil'
}
