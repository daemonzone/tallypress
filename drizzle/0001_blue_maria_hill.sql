ALTER TABLE "shops" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "last_sync_error" text;