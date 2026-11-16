ALTER TABLE "notification_outbox" DROP CONSTRAINT "notification_state_ck";
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_state_ck" CHECK ("notification_outbox"."state" IN ('QUEUED', 'RETRY', 'SENDING', 'SENT', 'ACCEPTED', 'NOT_CONFIGURED', 'OPTED_OUT', 'FAILED'));
--> statement-breakpoint
CREATE TABLE "whatsapp_settings" (
  "id" text PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "sender" text NOT NULL,
  "account_sid" text,
  "template" text NOT NULL,
  "language" text,
  "encrypted_secret" text NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "secret_changed_at" timestamp with time zone NOT NULL,
  CONSTRAINT "whatsapp_settings_singleton_ck" CHECK ("whatsapp_settings"."id" = 'whatsapp'),
  CONSTRAINT "whatsapp_settings_provider_ck" CHECK ("whatsapp_settings"."provider" IN ('META', 'TWILIO'))
);
--> statement-breakpoint
CREATE TABLE "whatsapp_health" (
  "id" text PRIMARY KEY NOT NULL,
  "state" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
