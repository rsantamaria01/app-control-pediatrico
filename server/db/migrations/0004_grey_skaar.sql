CREATE TABLE "email_health" (
	"id" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
