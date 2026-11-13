UPDATE "recovery_job" SET "state" = 'QUEUED' WHERE "state" = 'PENDING';--> statement-breakpoint
DROP INDEX "recovery_job_pending_idx";--> statement-breakpoint
ALTER TABLE "recovery_job" ALTER COLUMN "state" SET DEFAULT 'QUEUED';--> statement-breakpoint
CREATE INDEX "recovery_job_pending_idx" ON "recovery_job" USING btree ("state","created_at");--> statement-breakpoint
ALTER TABLE "recovery_job" DROP COLUMN "generation";--> statement-breakpoint
ALTER TABLE "recovery_job" DROP COLUMN "next_attempt_at";--> statement-breakpoint
ALTER TABLE "recovery_job" DROP COLUMN "claimed_until";