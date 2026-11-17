import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { user } from '../schema.ts'

export const notificationOutbox = pgTable('notification_outbox', {
  id: text('id').primaryKey(),
  eventKind: text('event_kind').notNull(),
  subjectId: text('subject_id').notNull(),
  occurrenceId: text('occurrence_id').notNull().default(''),
  channel: text('channel').notNull(),

  recipientKey: text('recipient_key').notNull(),
  recipientUserId: text('recipient_user_id').references(() => user.id, { onDelete: 'restrict' }),
  address: text('address'),
  state: text('state').notNull().default('QUEUED'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  errorClass: text('error_class')
}, table => [
  uniqueIndex('notification_intent_idx').on(table.eventKind, table.subjectId, table.occurrenceId, table.channel, table.recipientKey),
  index('notification_pending_idx').on(table.state, table.nextAttemptAt),
  check('notification_channel_ck', sql`${table.channel} IN ('EMAIL', 'WHATSAPP', 'IN_APP')`),
  check('notification_state_ck', sql`${table.state} IN ('QUEUED', 'RETRY', 'SENDING', 'SENT', 'ACCEPTED', 'NOT_CONFIGURED', 'OPTED_OUT', 'FAILED')`),
  check('notification_recipient_ck', sql`(${table.channel} = 'IN_APP' AND ${table.recipientUserId} IS NOT NULL AND ${table.address} IS NULL) OR (${table.channel} <> 'IN_APP' AND ${table.address} IS NULL)`)
])

export const whatsappSettings = pgTable('whatsapp_settings', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  sender: text('sender').notNull(),
  accountSid: text('account_sid'),
  template: text('template').notNull(),
  language: text('language'),
  encryptedSecret: text('encrypted_secret').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  secretChangedAt: timestamp('secret_changed_at', { withTimezone: true }).notNull()
}, table => [
  check('whatsapp_settings_singleton_ck', sql`${table.id} = 'whatsapp'`),
  check('whatsapp_settings_provider_ck', sql`${table.provider} IN ('META', 'TWILIO')`)
])

export const whatsappHealth = pgTable('whatsapp_health', {
  id: text('id').primaryKey(),
  state: text('state').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

export const notificationAttempt = pgTable('notification_attempt', {
  id: text('id').primaryKey(),
  outboxId: text('outbox_id').notNull().references(() => notificationOutbox.id, { onDelete: 'restrict' }),
  outcome: text('outcome').notNull(),
  errorClass: text('error_class'),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow()
}, table => [index('notification_attempt_outbox_idx').on(table.outboxId, table.attemptedAt)])

export const notificationPreference = pgTable('notification_preference', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(),
  enabled: boolean('enabled').notNull().default(false)
}, table => [uniqueIndex('notification_preference_user_channel_idx').on(table.userId, table.channel), check('notification_preference_channel_ck', sql`${table.channel} IN ('EMAIL', 'WHATSAPP', 'IN_APP')`)])

export const inAppNotice = pgTable('in_app_notice', {
  id: text('id').primaryKey(),
  outboxId: text('outbox_id').notNull().unique().references(() => notificationOutbox.id, { onDelete: 'restrict' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'restrict' }),
  eventKind: text('event_kind').notNull(),
  subjectId: text('subject_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp('read_at', { withTimezone: true })
}, table => [index('in_app_notice_user_idx').on(table.userId, table.createdAt)])
