CREATE TABLE "in_app_notice" (
	"id" text PRIMARY KEY NOT NULL,
	"outbox_id" text NOT NULL,
	"user_id" text NOT NULL,
	"event_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "in_app_notice_outbox_id_unique" UNIQUE("outbox_id")
);
--> statement-breakpoint
CREATE TABLE "notification_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"outbox_id" text NOT NULL,
	"outcome" text NOT NULL,
	"error_class" text,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"event_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"channel" text NOT NULL,
	"recipient_key" text NOT NULL,
	"recipient_user_id" text,
	"address" text,
	"state" text DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"error_class" text,
	CONSTRAINT "notification_channel_ck" CHECK ("notification_outbox"."channel" IN ('EMAIL', 'WHATSAPP', 'IN_APP')),
	CONSTRAINT "notification_state_ck" CHECK ("notification_outbox"."state" IN ('QUEUED', 'RETRY', 'SENT', 'NOT_CONFIGURED', 'OPTED_OUT', 'FAILED')),
	CONSTRAINT "notification_recipient_ck" CHECK (("notification_outbox"."channel" = 'IN_APP' AND "notification_outbox"."recipient_user_id" IS NOT NULL AND "notification_outbox"."address" IS NULL) OR ("notification_outbox"."channel" <> 'IN_APP' AND "notification_outbox"."address" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"user_id" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "notification_preference_channel_ck" CHECK ("notification_preference"."channel" IN ('EMAIL', 'WHATSAPP', 'IN_APP'))
);
--> statement-breakpoint
ALTER TABLE "in_app_notice" ADD CONSTRAINT "in_app_notice_outbox_id_notification_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."notification_outbox"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_notice" ADD CONSTRAINT "in_app_notice_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_attempt" ADD CONSTRAINT "notification_attempt_outbox_id_notification_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."notification_outbox"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "in_app_notice_user_idx" ON "in_app_notice" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_attempt_outbox_idx" ON "notification_attempt" USING btree ("outbox_id","attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_intent_idx" ON "notification_outbox" USING btree ("event_kind","subject_id","channel","recipient_key");--> statement-breakpoint
CREATE INDEX "notification_pending_idx" ON "notification_outbox" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preference_user_channel_idx" ON "notification_preference" USING btree ("user_id","channel");