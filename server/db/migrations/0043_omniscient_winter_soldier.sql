DROP INDEX "notification_intent_idx";--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "occurrence_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_intent_idx" ON "notification_outbox" USING btree ("event_kind","subject_id","occurrence_id","channel","recipient_key");