import type { useDb } from '../../server/utils/db'

export type NotificationChannel = 'EMAIL' | 'WHATSAPP' | 'IN_APP'
export type DomainEvent = { kind: 'BOOKING_PENDING' | 'BOOKING_APPROVED' | 'BOOKING_DECLINED' | 'BOOKING_RESCHEDULED' | 'BOOKING_CANCELLED' | 'VISIT_RECORDED', subjectId: string, occurrenceId?: string }
export type Recipient = { channel: 'IN_APP', userId: string } | { channel: 'EMAIL' | 'WHATSAPP', address: string, userId?: string }
export type OutboxId = string
export type DeliveryOutcome = { status: 'SENT' | 'NOT_CONFIGURED' | 'OPTED_OUT' | 'DEFERRED' | 'RETRY' | 'FAILED' | 'NOT_FOUND', id: OutboxId }
export type Tx = Parameters<Parameters<ReturnType<typeof useDb>['transaction']>[0]>[0]
