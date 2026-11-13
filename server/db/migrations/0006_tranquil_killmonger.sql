CREATE TABLE "recovery_job" (
	"id" text PRIMARY KEY NOT NULL,
	"payload" text NOT NULL,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"claimed_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "recovery_job_pending_idx" ON "recovery_job" USING btree ("state","next_attempt_at");