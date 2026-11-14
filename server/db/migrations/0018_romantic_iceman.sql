CREATE TABLE "guardian_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"guardian_id" text NOT NULL,
	"token_id" text,
	"payload" text,
	"state" text DEFAULT 'QUEUED' NOT NULL,
	"error_class" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guardian_phone" (
	"guardian_id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	CONSTRAINT "guardian_phone_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
ALTER TABLE "guardian_grant" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "guardian_grant" ADD COLUMN "relationship" text;--> statement-breakpoint
ALTER TABLE "guardian_delivery" ADD CONSTRAINT "guardian_delivery_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_delivery" ADD CONSTRAINT "guardian_delivery_guardian_id_user_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_delivery" ADD CONSTRAINT "guardian_delivery_token_id_setup_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."setup_token"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_phone" ADD CONSTRAINT "guardian_phone_guardian_id_user_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guardian_delivery_pending_idx" ON "guardian_delivery" USING btree ("state","created_at");