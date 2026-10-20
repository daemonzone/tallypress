ALTER TABLE "order_lines" ADD COLUMN "woo_product_id" bigint;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "woo_variation_id" bigint;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "default_cost_pct" numeric(5, 2);