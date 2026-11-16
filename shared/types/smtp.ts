import { z } from 'zod'

export type SmtpSecurity = 'NONE' | 'STARTTLS' | 'TLS'

export interface SmtpSettingsInput {
  host: string
  port: number
  security: SmtpSecurity
  username: string
  password: string
  fromName: string
  fromAddress: string
}

export interface SmtpSettingsView {
  source: 'ADMIN' | 'ENV'
  configured: boolean
  host: string | null
  port: number | null
  security: SmtpSecurity | null
  username: string | null
  fromName: string | null
  fromAddress: string | null
  updatedAt: Date | null
  secretChangedAt: Date | null
}

export type SmtpTransportConfig = SmtpSettingsInput

export const smtpSettingsSchema = z.object({
  host: z.string().trim().min(1).max(255).regex(/^[^\s\r\n]+$/),
  port: z.number().int().min(1).max(65535),
  security: z.enum(['NONE', 'STARTTLS', 'TLS']),
  username: z.string().max(255).regex(/^[^\r\n]*$/),
  password: z.string().max(4096).regex(/^[^\r\n]*$/),
  fromName: z.string().trim().max(255).regex(/^[^\r\n]*$/),
  fromAddress: z.email().max(254)
}).strict()

export const smtpTestSchema = z.object({ email: z.email().max(254) }).strict()
