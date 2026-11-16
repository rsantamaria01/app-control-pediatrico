import { check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const smtpSettings = pgTable('smtp_settings', {
  id: text('id').primaryKey(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  security: text('security').notNull(),
  username: text('username').notNull(),
  encryptedPassword: text('encrypted_password'),
  fromName: text('from_name').notNull(),
  fromAddress: text('from_address').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  secretChangedAt: timestamp('secret_changed_at', { withTimezone: true })
}, table => [
  check('smtp_settings_singleton_ck', sql`${table.id} = 'smtp'`),
  check('smtp_settings_port_ck', sql`${table.port} BETWEEN 1 AND 65535`),
  check('smtp_settings_security_ck', sql`${table.security} IN ('NONE', 'STARTTLS', 'TLS')`)
])
