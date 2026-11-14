ALTER TABLE "guardian_grant" ADD COLUMN "last_send_error" text;--> statement-breakpoint
ALTER TABLE "clinical_visit" ADD COLUMN "share_with_family" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinical_visit" ALTER COLUMN "share_with_family" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "clinical_visit" ADD COLUMN "next_control_at" timestamp with time zone;