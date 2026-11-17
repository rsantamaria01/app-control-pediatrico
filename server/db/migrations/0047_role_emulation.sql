ALTER TABLE "session" ADD COLUMN "emulated_role" text;
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "emulated_user_id" text REFERENCES "user"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "audit_event" ADD COLUMN "emulated_role" text;
--> statement-breakpoint
ALTER TABLE "audit_event" ADD COLUMN "emulated_user_id" text;
--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_emulation_role_ck" CHECK ("emulated_role" IS NULL OR "emulated_role" IN ('ADMIN', 'DOCTOR', 'ASSISTANT', 'PATIENT'));
--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_emulation_user_ck" CHECK (("emulated_role" = 'PATIENT' AND "emulated_user_id" IS NOT NULL) OR ("emulated_role" IS NOT NULL AND "emulated_role" <> 'PATIENT' AND "emulated_user_id" IS NULL) OR ("emulated_role" IS NULL AND "emulated_user_id" IS NULL));
