CREATE TABLE "order_coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"code" text NOT NULL,
	"discount" numeric(14, 2) NOT NULL,
	CONSTRAINT "order_coupons_order_id_code_unique" UNIQUE("order_id","code")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_method_title" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "transaction_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "created_via" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "source_type" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "utm_source" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "utm_medium" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_total" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_coupons" ADD CONSTRAINT "order_coupons_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_coupons" ADD CONSTRAINT "order_coupons_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_coupons_shop_id_code_index" ON "order_coupons" USING btree ("shop_id","code");