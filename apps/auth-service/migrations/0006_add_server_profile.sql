CREATE TABLE IF NOT EXISTS "server_profile" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
