CREATE TABLE "clinic_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact_email" text NOT NULL,
	"primary" text NOT NULL,
	"logo" text,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinic_settings_singleton_ck" CHECK ("clinic_settings"."id" = 'clinic'),
	CONSTRAINT "clinic_settings_primary_ck" CHECK ("clinic_settings"."primary" IN ('brand', 'teal', 'indigo', 'violet', 'rose', 'emerald'))
);
--> statement-breakpoint
CREATE TABLE "data_request" (
	"id" text PRIMARY KEY NOT NULL,
	"requester_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"handled_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_request_type_ck" CHECK ("data_request"."type" IN ('VIEW', 'EXPORT', 'DELETE')),
	CONSTRAINT "data_request_status_ck" CHECK ("data_request"."status" IN ('QUEUED', 'UNDER_REVIEW', 'CLOSED'))
);
--> statement-breakpoint
ALTER TABLE "data_request" ADD CONSTRAINT "data_request_requester_id_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_request" ADD CONSTRAINT "data_request_handled_by_user_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_request_requester_idx" ON "data_request" USING btree ("requester_id","created_at");