ALTER TABLE "recovery_job" ADD COLUMN "token_id" text;--> statement-breakpoint
ALTER TABLE "recovery_job" ADD COLUMN "delivery_payload" text;--> statement-breakpoint
ALTER TABLE "recovery_job" ADD COLUMN "generation" integer DEFAULT 0 NOT NULL;