CREATE TABLE "staff_notice_read" (
	"user_id" text NOT NULL,
	"notice_id" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_notice_read_user_id_notice_id_pk" PRIMARY KEY("user_id","notice_id")
);
--> statement-breakpoint
ALTER TABLE "staff_notice_read" ADD CONSTRAINT "staff_notice_read_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;