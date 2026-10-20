ALTER TABLE "items" ADD COLUMN "status" text DEFAULT 'publish' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "history_start" timestamp with time zone;