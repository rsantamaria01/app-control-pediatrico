DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "user" GROUP BY lower(btrim(email)) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Canonical email collision: manual identity review required before migration';
  END IF;
END $$;--> statement-breakpoint
UPDATE "user" SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"));--> statement-breakpoint
UPDATE "guardian_grant" SET "contact_email" = lower(btrim("contact_email")) WHERE "contact_email" <> lower(btrim("contact_email"));--> statement-breakpoint
UPDATE "patient_contact_intake" SET "email" = lower(btrim("email")) WHERE "email" IS NOT NULL AND "email" <> lower(btrim("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_canonical_idx" ON "user" USING btree (lower(btrim("email")));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_email_canonical_ck" CHECK ("user"."email" = lower(btrim("user"."email")));