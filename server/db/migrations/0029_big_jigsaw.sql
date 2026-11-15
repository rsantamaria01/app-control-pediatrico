CREATE TABLE "appointment" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text,
	"name" text NOT NULL,
	"contact" text NOT NULL,
	"reason" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"time_zone" text DEFAULT 'America/Guayaquil' NOT NULL,
	"status" text NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "appointment_status_ck" CHECK ("appointment"."status" IN ('PENDING','CONFIRMED','ATTENDED','CANCELLED')),
	CONSTRAINT "appointment_interval_ck" CHECK ("appointment"."ends_at" > "appointment"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "blocked_hour" (
	"id" text PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"from_time" text NOT NULL,
	"to_time" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"duration_minutes" integer NOT NULL,
	CONSTRAINT "clinic_schedule_duration_ck" CHECK ("clinic_schedule"."duration_minutes" BETWEEN 15 AND 120)
);
--> statement-breakpoint
CREATE TABLE "opening_hour" (
	"weekday" integer PRIMARY KEY NOT NULL,
	"open" text NOT NULL,
	"close" text NOT NULL,
	CONSTRAINT "opening_hour_weekday_ck" CHECK ("opening_hour"."weekday" BETWEEN 0 AND 6)
);
--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_start_idx" ON "appointment" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "blocked_hour_date_idx" ON "blocked_hour" USING btree ("date");