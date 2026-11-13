ALTER TABLE "user" DROP CONSTRAINT "user_username_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "user_username_lower_idx" ON "user" USING btree (lower("username"));