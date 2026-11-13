CREATE TABLE "setup_token" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"digest" text NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	CONSTRAINT "setup_token_digest_unique" UNIQUE("digest")
);
--> statement-breakpoint
ALTER TABLE "setup_token" ADD CONSTRAINT "setup_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;