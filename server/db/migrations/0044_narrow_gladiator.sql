CREATE TABLE "smtp_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"security" text NOT NULL,
	"username" text NOT NULL,
	"encrypted_password" text,
	"from_name" text NOT NULL,
	"from_address" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"secret_changed_at" timestamp with time zone,
	CONSTRAINT "smtp_settings_singleton_ck" CHECK ("smtp_settings"."id" = 'smtp'),
	CONSTRAINT "smtp_settings_port_ck" CHECK ("smtp_settings"."port" BETWEEN 1 AND 65535),
	CONSTRAINT "smtp_settings_security_ck" CHECK ("smtp_settings"."security" IN ('NONE', 'STARTTLS', 'TLS'))
);
