import { z } from 'zod'
import { Gender } from '../utils/enums'

export const normalizePatientName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim().replace(/\s+/g, ' ')

export const ecuadorIdSchema = z.string().regex(/^\d{10}$/, 'La cédula debe tener 10 dígitos').refine((value) => {
  const province = Number(value.slice(0, 2))
  if (province < 1 || (province > 24 && province !== 30) || Number(value[2]) >= 6) return false
  const sum = [...value.slice(0, 9)].reduce((total, digit, index) => {
    const product = Number(digit) * (index % 2 === 0 ? 2 : 1)
    return total + (product > 9 ? product - 9 : product)
  }, 0)
  return (10 - sum % 10) % 10 === Number(value[9])
}, 'Cédula ecuatoriana inválida')

const contactSchema = z.strictObject({
  name: z.string().trim().min(2).max(160),
  relationship: z.string().trim().min(2).max(80),
  phone: z.string().regex(/^(?:\+593|0)?9\d{8}$/, 'Teléfono ecuatoriano inválido').transform(value => value.startsWith('+593') ? `0${value.slice(4)}` : value.startsWith('0') ? value : `0${value}`),
  email: z.string().trim().pipe(z.union([z.email().max(254).transform(value => value.toLowerCase()), z.literal('')])).default(''),
  invite: z.boolean().default(false),
  proof: z.string().trim().min(8).max(500).optional(),
  confirmedGuardianId: z.uuid().optional()
}).refine(value => !value.invite || Boolean(value.email), { path: ['invite'], message: 'Se requiere un correo válido para invitar' })

export const quickPatientSchema = z.strictObject({
  givenNames: z.string().trim().min(2).max(80),
  surnames: z.string().trim().min(2).max(80),
  birthDate: z.iso.date(),
  sex: z.enum(Gender),
  nationalId: ecuadorIdSchema.optional(),
  hsmRecord: z.string().trim().min(1).max(100).optional(),
  confirmPossibleMatches: z.boolean().default(false),
  contacts: z.array(contactSchema).min(1).max(8)
})

export type QuickPatientInput = z.input<typeof quickPatientSchema>
