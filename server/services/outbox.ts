import { createHash, randomUUID } from 'node:crypto'
import { and, eq, inArray, lte, sql } from 'drizzle-orm'
import type { Actor } from '../../shared/types/access'
import type { DeliveryOutcome, DomainEvent, NotificationChannel, OutboxId, Recipient, Tx } from '../../shared/types/notification'
import { bookingRequest, guardianGrant, inAppNotice, notificationAttempt, notificationOutbox, notificationPreference, user, visit, visitSharing } from '../db/schema'
import { useDb } from '../utils/db'

export type ProviderStatus = 'READY' | 'NOT_CONFIGURED' | 'FAILED'
export type ProviderAdapter = { channel: 'EMAIL' | 'WHATSAPP', status(): ProviderStatus, send(input: { outboxId: OutboxId, address: string, event: DomainEvent, idempotencyKey: string }): Promise<'SENT' | 'RETRY' | 'FAILED'> }

export function providerStatus(channel: NotificationChannel): ProviderStatus {
  return channel === 'IN_APP' ? 'READY' : 'NOT_CONFIGURED'
}

export async function queueNotification(tx: Tx, event: DomainEvent, recipient: Recipient): Promise<OutboxId> {
  if (!['BOOKING_PENDING', 'BOOKING_APPROVED', 'BOOKING_DECLINED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED', 'VISIT_RECORDED'].includes(event.kind) || !event.subjectId || (event.occurrenceId && event.kind !== 'BOOKING_RESCHEDULED')) throw new Error('Invalid notification event')
  if (!['EMAIL', 'WHATSAPP', 'IN_APP'].includes(recipient.channel) || (recipient.channel === 'IN_APP' ? !recipient.userId : !recipient.address?.trim())) throw new Error('Invalid notification recipient')
  if (recipient.channel === 'EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.address.trim())) throw new Error('Invalid email recipient')
  if (recipient.channel === 'WHATSAPP' && !/^\+[1-9]\d{7,14}$/.test(recipient.address.trim())) throw new Error('Invalid WhatsApp recipient')
  if (recipient.channel !== 'IN_APP' && recipient.userId) {
    const [account] = await tx.select({ email: user.email }).from(user).where(eq(user.id, recipient.userId))
    if (recipient.channel !== 'EMAIL' || account?.email !== recipient.address.trim().toLowerCase()) throw new Error('Notification recipient does not match account')
  }
  if (recipient.userId && event.kind.startsWith('BOOKING_')) {
    const [booking] = await tx.select({ guardianId: bookingRequest.guardianId }).from(bookingRequest).where(eq(bookingRequest.id, event.subjectId))
    if (booking && booking.guardianId !== recipient.userId) throw new Error('Notification recipient does not own booking')
  }
  if (!recipient.userId && event.kind === 'VISIT_RECORDED') throw new Error('Visit notice requires a verified guardian')
  if (recipient.userId && event.kind === 'VISIT_RECORDED') {
    const [access] = await tx.select({ id: visit.id }).from(visit).innerJoin(guardianGrant, and(eq(guardianGrant.patientId, visit.patientId), eq(guardianGrant.guardianId, recipient.userId), eq(guardianGrant.status, 'ACTIVE'))).leftJoin(visitSharing, eq(visitSharing.visitId, visit.id)).where(and(eq(visit.id, event.subjectId), sql`coalesce(${visitSharing.shared}, ${visit.shareWithFamily}) = true`))
    if (!access) throw new Error('Notification recipient has no shared visit')
  }
  const key = recipient.channel === 'IN_APP' ? recipient.userId : createHash('sha256').update(`${recipient.channel.toLowerCase()}:${recipient.address.trim().toLowerCase()}`).digest('hex')
  const [inserted] = await tx.insert(notificationOutbox).values({
    id: randomUUID(), eventKind: event.kind, subjectId: event.subjectId, occurrenceId: event.occurrenceId ?? '',
    channel: recipient.channel, recipientKey: key,
    recipientUserId: recipient.userId,
    address: null
  }).onConflictDoNothing({ target: [notificationOutbox.eventKind, notificationOutbox.subjectId, notificationOutbox.occurrenceId, notificationOutbox.channel, notificationOutbox.recipientKey] }).returning({ id: notificationOutbox.id })
  if (inserted) return inserted.id
  const [existing] = await tx.select({ id: notificationOutbox.id }).from(notificationOutbox).where(and(eq(notificationOutbox.eventKind, event.kind), eq(notificationOutbox.subjectId, event.subjectId), eq(notificationOutbox.occurrenceId, event.occurrenceId ?? ''), eq(notificationOutbox.channel, recipient.channel), eq(notificationOutbox.recipientKey, key)))
  if (!existing) throw new Error('Notification intent not found')
  return existing.id
}

export async function deliver(outboxId: OutboxId, now = new Date(), adapter?: ProviderAdapter): Promise<DeliveryOutcome> {
  const claimed = await prepareDelivery(outboxId, now, adapter)
  if ('outcome' in claimed) return claimed.outcome
  let outcome: 'SENT' | 'RETRY' | 'FAILED'
  try {
    const result = await claimed.adapter.send({ outboxId, address: claimed.address, event: claimed.event, idempotencyKey: outboxId })
    outcome = result === 'SENT' || result === 'RETRY' || result === 'FAILED' ? result : 'FAILED'
  } catch {
    outcome = 'FAILED'
  }
  return useDb().transaction(async (tx) => {
    const [row] = await tx.select().from(notificationOutbox).where(eq(notificationOutbox.id, outboxId)).for('update')
    if (!row || row.state !== 'SENDING') return { id: outboxId, status: 'FAILED' }
    const state = outcome === 'RETRY' && row.attempts >= 3 ? 'FAILED' : outcome
    const errorClass = state === 'RETRY' ? 'RetryRequested' : state === 'FAILED' ? outcome === 'RETRY' ? 'RetryExhausted' : 'DeliveryUncertain' : null
    await tx.insert(notificationAttempt).values({ id: randomUUID(), outboxId, outcome: state, errorClass, attemptedAt: now })
    await tx.update(notificationOutbox).set({ state, nextAttemptAt: state === 'RETRY' ? new Date(now.getTime() + row.attempts * 60000) : row.nextAttemptAt, deliveredAt: state === 'SENT' ? now : null, errorClass }).where(eq(notificationOutbox.id, outboxId))
    return { id: outboxId, status: state }
  })
}

async function prepareDelivery(outboxId: OutboxId, now: Date, adapter?: ProviderAdapter): Promise<{ outcome: DeliveryOutcome } | { adapter: ProviderAdapter, address: string, event: DomainEvent }> {
  return useDb().transaction(async (tx) => {
    const [row] = await tx.select().from(notificationOutbox).where(eq(notificationOutbox.id, outboxId)).for('update')
    if (!row) return { outcome: { id: outboxId, status: 'NOT_FOUND' } }
    if (row.state === 'SENT' || row.state === 'NOT_CONFIGURED' || row.state === 'OPTED_OUT' || row.state === 'FAILED') return { outcome: { id: outboxId, status: row.state as DeliveryOutcome['status'] } }
    if (row.state === 'SENDING' || row.nextAttemptAt > now) return { outcome: { id: outboxId, status: 'DEFERRED' } }
    const channel = row.channel as NotificationChannel
    if (row.recipientUserId && row.eventKind.startsWith('BOOKING_')) {
      const [booking] = await tx.select({ guardianId: bookingRequest.guardianId, patientId: bookingRequest.patientId }).from(bookingRequest).where(eq(bookingRequest.id, row.subjectId))
      if (booking && (booking.guardianId !== row.recipientUserId || !booking.patientId || !await tx.select({ guardianId: guardianGrant.guardianId }).from(guardianGrant).where(and(eq(guardianGrant.patientId, booking.patientId), eq(guardianGrant.guardianId, row.recipientUserId), eq(guardianGrant.status, 'ACTIVE'))).then(rows => rows.length > 0))) {
        await tx.update(notificationOutbox).set({ state: 'OPTED_OUT' }).where(eq(notificationOutbox.id, outboxId))
        return { outcome: { id: outboxId, status: 'OPTED_OUT' } }
      }
    }
    if (row.recipientUserId && row.eventKind === 'VISIT_RECORDED') {
      const [access] = await tx.select({ id: visit.id }).from(visit).innerJoin(guardianGrant, and(eq(guardianGrant.patientId, visit.patientId), eq(guardianGrant.guardianId, row.recipientUserId), eq(guardianGrant.status, 'ACTIVE'))).leftJoin(visitSharing, eq(visitSharing.visitId, visit.id)).where(and(eq(visit.id, row.subjectId), sql`coalesce(${visitSharing.shared}, ${visit.shareWithFamily}) = true`))
      if (!access) {
        await tx.update(notificationOutbox).set({ state: 'OPTED_OUT' }).where(eq(notificationOutbox.id, outboxId))
        return { outcome: { id: outboxId, status: 'OPTED_OUT' } }
      }
    }
    const [preference] = row.recipientUserId ? await tx.select().from(notificationPreference).where(and(eq(notificationPreference.userId, row.recipientUserId), eq(notificationPreference.channel, channel))) : []
    if (channel !== 'IN_APP' && (adapter?.channel !== channel || adapter.status() !== 'READY')) {
      const failed = adapter?.channel === channel && adapter.status() === 'FAILED'
      const state = failed ? 'FAILED' : 'NOT_CONFIGURED'
      const errorClass = failed ? 'ProviderFailed' : 'ProviderNotConfigured'
      await tx.insert(notificationAttempt).values({ id: randomUUID(), outboxId, outcome: state, errorClass, attemptedAt: now })
      await tx.update(notificationOutbox).set({ state, attempts: row.attempts + 1, errorClass }).where(eq(notificationOutbox.id, outboxId))
      return { outcome: { id: outboxId, status: state } }
    }
    const optedOut = preference ? !preference.enabled : channel !== 'IN_APP'
    if (optedOut) {
      await tx.update(notificationOutbox).set({ state: 'OPTED_OUT' }).where(eq(notificationOutbox.id, outboxId))
      return { outcome: { id: outboxId, status: 'OPTED_OUT' } }
    }
    if (channel !== 'IN_APP') {
      const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
      const localHour = Number(local.find(part => part.type === 'hour')?.value)
      const localMinute = Number(local.find(part => part.type === 'minute')?.value)
      if (localHour < 8 || localHour >= 20) {
        const delayMinutes = (localHour < 8 ? 8 * 60 : 32 * 60) - (localHour * 60 + localMinute)
        await tx.update(notificationOutbox).set({ nextAttemptAt: new Date(now.getTime() + delayMinutes * 60000) }).where(eq(notificationOutbox.id, outboxId))
        return { outcome: { id: outboxId, status: 'DEFERRED' } }
      }
    }
    if (channel !== 'IN_APP') {
      const [account] = row.recipientUserId ? await tx.select({ email: user.email }).from(user).where(eq(user.id, row.recipientUserId)) : []
      if (!account || channel !== 'EMAIL' || createHash('sha256').update(`email:${account.email.trim().toLowerCase()}`).digest('hex') !== row.recipientKey) {
        await tx.update(notificationOutbox).set({ state: 'FAILED', errorClass: 'RecipientUnavailable' }).where(eq(notificationOutbox.id, outboxId))
        await tx.insert(notificationAttempt).values({ id: randomUUID(), outboxId, outcome: 'FAILED', errorClass: 'RecipientUnavailable', attemptedAt: now })
        return { outcome: { id: outboxId, status: 'FAILED' } }
      }
      await tx.update(notificationOutbox).set({ state: 'SENDING', attempts: row.attempts + 1 }).where(eq(notificationOutbox.id, outboxId))
      return { adapter: adapter!, address: account.email, event: { kind: row.eventKind as DomainEvent['kind'], subjectId: row.subjectId } }
    }
    const state = 'SENT'
    if (channel === 'IN_APP') {
      await tx.insert(inAppNotice).values({ id: randomUUID(), outboxId, userId: row.recipientUserId!, eventKind: row.eventKind, subjectId: row.subjectId }).onConflictDoNothing({ target: inAppNotice.outboxId })
    }
    if (state === 'SENT') await tx.insert(notificationAttempt).values({ id: randomUUID(), outboxId, outcome: state, attemptedAt: now })
    await tx.update(notificationOutbox).set({ state, attempts: row.attempts + (state === 'SENT' ? 1 : 0), deliveredAt: state === 'SENT' ? now : null }).where(eq(notificationOutbox.id, outboxId))
    return { outcome: { id: outboxId, status: state } }
  })
}

export async function reconcileNotificationOutbox(): Promise<number> {
  return useDb().transaction(async (tx) => {
    const rows = await tx.update(notificationOutbox).set({ state: 'FAILED', errorClass: 'InterruptedDelivery' }).where(eq(notificationOutbox.state, 'SENDING')).returning({ id: notificationOutbox.id })
    for (const row of rows) await tx.insert(notificationAttempt).values({ id: randomUUID(), outboxId: row.id, outcome: 'FAILED', errorClass: 'InterruptedDelivery' })
    return rows.length
  })
}

export async function processNotificationOutbox(now = new Date(), limit = 50): Promise<number> {
  const rows = await useDb().select({ id: notificationOutbox.id }).from(notificationOutbox).where(and(inArray(notificationOutbox.state, ['QUEUED', 'RETRY']), lte(notificationOutbox.nextAttemptAt, now))).orderBy(notificationOutbox.createdAt).limit(limit)
  for (const row of rows) await deliver(row.id, now)
  return rows.length
}

export async function listInAppNotices(actor: Actor) {
  if (actor.roles.length !== 1 || !actor.roles.includes('PATIENT')) return []
  return useDb().select({ id: inAppNotice.id, outboxId: inAppNotice.outboxId, userId: inAppNotice.userId, eventKind: inAppNotice.eventKind, subjectId: inAppNotice.subjectId, createdAt: inAppNotice.createdAt, readAt: inAppNotice.readAt }).from(inAppNotice).where(and(eq(inAppNotice.userId, actor.id), sql`(${inAppNotice.eventKind} <> 'VISIT_RECORDED' OR EXISTS (SELECT 1 FROM ${visit} v JOIN ${guardianGrant} g ON g.patient_id = v.patient_id AND g.guardian_id = ${actor.id} AND g.status = 'ACTIVE' LEFT JOIN ${visitSharing} s ON s.visit_id = v.id WHERE v.id = ${inAppNotice.subjectId} AND coalesce(s.shared, v.share_with_family) = true))`, sql`(${inAppNotice.eventKind} NOT LIKE 'BOOKING_%' OR EXISTS (SELECT 1 FROM ${bookingRequest} b JOIN ${guardianGrant} g ON g.patient_id = b.patient_id AND g.guardian_id = ${actor.id} AND g.status = 'ACTIVE' WHERE b.id = ${inAppNotice.subjectId} AND b.guardian_id = ${actor.id}))`)).orderBy(sql`${inAppNotice.createdAt} DESC`)
}
