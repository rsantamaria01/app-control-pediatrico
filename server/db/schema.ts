import { bigint, boolean, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  username: text('username'),
  displayUsername: text('display_username'),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
}, table => [uniqueIndex('user_username_lower_idx').on(sql`lower(${table.username})`)])

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' })
}, table => [index('session_user_idx').on(table.userId)])

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
}, table => [index('account_user_idx').on(table.userId)])

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
}, table => [index('verification_identifier_idx').on(table.identifier)])

export const userRole = pgTable('user_role', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: text('role').notNull()
}, table => [primaryKey({ columns: [table.userId, table.role] })])

export const auditEvent = pgTable('audit_event', {
  id: text('id').primaryKey(),
  actorId: text('actor_id'),
  action: text('action').notNull(),
  subjectId: text('subject_id'),
  outcome: text('outcome').notNull(),
  occurredAt: timestamp('occurred_at').notNull().defaultNow()
}, table => [index('audit_occurred_idx').on(table.occurredAt)])

export const setupToken = pgTable('setup_token', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  digest: text('digest').notNull().unique(),
  purpose: text('purpose').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at')
})

export const emailHealth = pgTable('email_health', {
  id: text('id').primaryKey(),
  state: text('state').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
})

export const recoveryJob = pgTable('recovery_job', {
  id: text('id').primaryKey(),
  payload: text('payload').notNull(),
  tokenId: text('token_id'),
  deliveryPayload: text('delivery_payload'),
  state: text('state').notNull().default('QUEUED'),
  attempts: integer('attempts').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at')
}, table => [index('recovery_job_pending_idx').on(table.state, table.createdAt)])

export const bootstrapMarker = pgTable('bootstrap_marker', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow()
}, table => [uniqueIndex('bootstrap_user_idx').on(table.userId)])

export const rateLimit = pgTable('rateLimit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('lastRequest', { mode: 'number' }).notNull()
})
