import type { useDb } from '../../server/utils/db'
import { z } from 'zod'

export type NotificationChannel = 'EMAIL' | 'WHATSAPP' | 'IN_APP'
export type DomainEvent = { kind: 'BOOKING_PENDING' | 'BOOKING_APPROVED' | 'BOOKING_DECLINED' | 'BOOKING_RESCHEDULED' | 'BOOKING_CANCELLED' | 'VISIT_RECORDED' | 'CHECKUP_DUE', subjectId: string, occurrenceId?: string }
export type Recipient = { channel: 'IN_APP', userId: string } | { channel: 'EMAIL' | 'WHATSAPP', address: string, userId?: string }
export type OutboxId = string
export type DeliveryOutcome = { status: 'SENT' | 'ACCEPTED' | 'NOT_CONFIGURED' | 'OPTED_OUT' | 'DEFERRED' | 'RETRY' | 'FAILED' | 'NOT_FOUND', id: OutboxId }
export const whatsappSettingsSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('META'), sender: z.string().regex(/^\d{5,30}$/), template: z.string().regex(/^[a-z][a-z\d_]{1,100}$/), language: z.string().regex(/^[a-z]{2}(?:_[A-Z]{2})?$/), secret: z.string().max(4096) }).strict(),
  z.object({ provider: z.literal('TWILIO'), sender: z.string().regex(/^\+[1-9]\d{7,14}$/), accountSid: z.string().regex(/^AC[a-f\d]{32}$/i), template: z.string().regex(/^HX[a-f\d]{32}$/i), secret: z.string().max(4096) }).strict()
])
export type WhatsAppSettingsInput = z.infer<typeof whatsappSettingsSchema>
export type WhatsAppTransport = WhatsAppSettingsInput
export type WhatsAppSettingsView = { source: 'ADMIN' | 'ENV', configured: boolean, provider: 'META' | 'TWILIO' | null, sender: string | null, template: string | null, accountSid: string | null, language: string | null, updatedAt: Date | null, secretChangedAt: Date | null }
export type Tx = Parameters<Parameters<ReturnType<typeof useDb>['transaction']>[0]>[0]
