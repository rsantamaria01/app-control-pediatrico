import { check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { user } from '../schema.ts'

export const clinicSettings = pgTable('clinic_settings', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  contactEmail: text('contact_email').notNull(),
  primary: text('primary').notNull(),
  logo: text('logo'),
  updatedBy: text('updated_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => [check('clinic_settings_singleton_ck', sql`${table.id} = 'clinic'`), check('clinic_settings_primary_ck', sql`${table.primary} IN ('brand', 'teal', 'indigo', 'violet', 'rose', 'emerald')`)])

export const dataRequest = pgTable('data_request', {
  id: text('id').primaryKey(),
  requesterId: text('requester_id').notNull().references(() => user.id, { onDelete: 'restrict' }),
  type: text('type').notNull(),
  status: text('status').notNull().default('QUEUED'),
  handledBy: text('handled_by').references(() => user.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => [index('data_request_requester_idx').on(table.requesterId, table.createdAt), check('data_request_type_ck', sql`${table.type} IN ('VIEW', 'EXPORT', 'DELETE')`), check('data_request_status_ck', sql`${table.status} IN ('QUEUED', 'UNDER_REVIEW', 'CLOSED')`)])
