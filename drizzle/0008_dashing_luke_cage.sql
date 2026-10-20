ALTER TABLE "items" ADD COLUMN "regular_price" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "cost_source" text DEFAULT 'estimate' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "subtotal_gross" numeric(14, 2);