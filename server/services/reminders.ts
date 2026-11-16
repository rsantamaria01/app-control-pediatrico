import { createHash } from 'node:crypto'
import { and, eq, lte, notExists, sql } from 'drizzle-orm'
import { completedCheckup, guardianGrant, guardianPhone, individualCheckup, notificationOutbox, notificationPreference, user } from '../db/schema'
import { useDb } from '../utils/db'
import { queueNotification } from './outbox'

export async function scanCheckupReminders(now = new Date()): Promise<number> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const db = useDb()
  const due = await db.select({ id: individualCheckup.id, guardianId: guardianGrant.guardianId, email: user.email, phone: guardianPhone.phone })
    .from(individualCheckup)
    .innerJoin(guardianGrant, and(eq(guardianGrant.patientId, individualCheckup.patientId), eq(guardianGrant.status, 'ACTIVE')))
    .innerJoin(user, eq(user.id, guardianGrant.guardianId))
    .leftJoin(guardianPhone, and(eq(guardianPhone.guardianId, guardianGrant.guardianId), eq(guardianPhone.phone, guardianGrant.contactPhone)))
    .where(and(lte(individualCheckup.date, today), notExists(db.select({ id: completedCheckup.id }).from(completedCheckup).where(eq(completedCheckup.individualId, individualCheckup.id)))))
  let queued = 0
  for (const row of due) {
    const channels = ['IN_APP'] as ('IN_APP' | 'EMAIL' | 'WHATSAPP')[]
    const consents = await db.select({ channel: notificationPreference.channel }).from(notificationPreference).where(and(eq(notificationPreference.userId, row.guardianId), eq(notificationPreference.enabled, true)))
    if (consents.some(consent => consent.channel === 'EMAIL')) channels.push('EMAIL')
    if (row.phone && consents.some(consent => consent.channel === 'WHATSAPP')) channels.push('WHATSAPP')
    for (const channel of channels) {
      const inserted = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${row.id}:${row.guardianId}:${channel}`}))`)
        const recipientKey = channel === 'WHATSAPP' ? createHash('sha256').update(`whatsapp:${row.phone!.toLowerCase()}`).digest('hex') : null
        const prior = await tx.select({ id: notificationOutbox.id, state: notificationOutbox.state, recipientKey: notificationOutbox.recipientKey }).from(notificationOutbox).where(and(eq(notificationOutbox.eventKind, 'CHECKUP_DUE'), eq(notificationOutbox.subjectId, row.id), eq(notificationOutbox.channel, channel), eq(notificationOutbox.recipientUserId, row.guardianId)))
        if (channel === 'WHATSAPP' && prior.some(notice => notice.state === 'ACCEPTED' || notice.state === 'SENT')) return false
        const existing = prior.find(notice => !recipientKey || notice.recipientKey === recipientKey)
        if (existing && (channel === 'IN_APP' || existing.state !== 'OPTED_OUT')) return false
        const [eligible] = await tx.select({ id: individualCheckup.id }).from(individualCheckup).innerJoin(guardianGrant, and(eq(guardianGrant.patientId, individualCheckup.patientId), eq(guardianGrant.guardianId, row.guardianId), eq(guardianGrant.status, 'ACTIVE'))).where(and(eq(individualCheckup.id, row.id), notExists(tx.select({ id: completedCheckup.id }).from(completedCheckup).where(eq(completedCheckup.individualId, row.id)))))
        if (!eligible) return false
        if (channel !== 'IN_APP') {
          const [consent] = await tx.select({ enabled: notificationPreference.enabled }).from(notificationPreference).where(and(eq(notificationPreference.userId, row.guardianId), eq(notificationPreference.channel, channel)))
          if (!consent?.enabled) return false
        }
        if (channel === 'WHATSAPP') {
          const [phone] = await tx.select({ phone: guardianPhone.phone }).from(guardianPhone).innerJoin(guardianGrant, and(eq(guardianGrant.guardianId, guardianPhone.guardianId), eq(guardianGrant.status, 'ACTIVE'))).innerJoin(individualCheckup, eq(individualCheckup.patientId, guardianGrant.patientId)).where(and(eq(individualCheckup.id, row.id), eq(guardianPhone.guardianId, row.guardianId), eq(guardianPhone.phone, guardianGrant.contactPhone)))
          if (!phone || phone.phone !== row.phone) return false
        }
        if (existing) {
          await tx.update(notificationOutbox).set({ state: 'QUEUED', errorClass: null }).where(and(eq(notificationOutbox.id, existing.id), eq(notificationOutbox.state, 'OPTED_OUT')))
        } else {
          await queueNotification(tx, { kind: 'CHECKUP_DUE', subjectId: row.id }, channel === 'IN_APP' ? { channel, userId: row.guardianId } : { channel, userId: row.guardianId, address: channel === 'EMAIL' ? row.email : row.phone! })
        }
        return true
      })
      if (inserted) queued++
    }
  }
  return queued
}
