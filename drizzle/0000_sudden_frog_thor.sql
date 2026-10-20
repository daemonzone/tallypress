CREATE TYPE "public"."ledger_kind" AS ENUM('opening_balance', 'restock', 'withdrawal', 'expense', 'adjustment');--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"woo_product_id" bigint NOT NULL,
	"woo_variation_id" bigint DEFAULT 0 NOT NULL,
	"product_name" text NOT NULL,
	"variation_label" text,
	"sku" text,
	"manages_stock" boolean DEFAULT false NOT NULL,
	"stock_qty" numeric(14, 3),
	"manual_unit_cost" numeric(14, 4),
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_shop_id_woo_product_id_woo_variation_id_unique" UNIQUE("shop_id","woo_product_id","woo_variation_id")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"restock_lot_id" uuid,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "month_closings" (
	"shop_id" uuid NOT NULL,
	"month" date NOT NULL,
	"orders_count" integer NOT NULL,
	"gross_total" numeric(14, 2) NOT NULL,
	"vat_total" numeric(14, 2) NOT NULL,
	"cogs_total" numeric(14, 2) NOT NULL,
	"tax_reserve" numeric(14, 2) NOT NULL,
	"net_total" numeric(14, 2) NOT NULL,
	"balance" numeric(14, 2) NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "month_closings_shop_id_month_pk" PRIMARY KEY("shop_id","month")
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"woo_line_id" bigint NOT NULL,
	"item_id" uuid,
	"quantity" numeric(14, 3) NOT NULL,
	"gross_total" numeric(14, 2) NOT NULL,
	"tax_total" numeric(14, 2) NOT NULL,
	"unit_cost_snapshot" numeric(14, 4),
	CONSTRAINT "order_lines_shop_id_order_id_woo_line_id_unique" UNIQUE("shop_id","order_id","woo_line_id")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"woo_order_id" bigint NOT NULL,
	"status" text NOT NULL,
	"placed_at" timestamp with time zone NOT NULL,
	"gross_total" numeric(14, 2) NOT NULL,
	"tax_total" numeric(14, 2) NOT NULL,
	"shipping_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"refunded_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_shop_id_woo_order_id_unique" UNIQUE("shop_id","woo_order_id")
);
--> statement-breakpoint
CREATE TABLE "restock_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_cost" numeric(14, 4) NOT NULL,
	"purchased_at" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'restock' NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"woo_url" text NOT NULL,
	"woo_consumer_key" text NOT NULL,
	"woo_consumer_secret" text NOT NULL,
	"currency" char(3) NOT NULL,
	"default_locale" text DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'Europe/Rome' NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT '22' NOT NULL,
	"income_tax_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_base" text DEFAULT 'profit' NOT NULL,
	"owner_share_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"baseline_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_restock_lot_id_restock_lots_id_fk" FOREIGN KEY ("restock_lot_id") REFERENCES "public"."restock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_closings" ADD CONSTRAINT "month_closings_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restock_lots" ADD CONSTRAINT "restock_lots_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restock_lots" ADD CONSTRAINT "restock_lots_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_shop_id_occurred_at_index" ON "ledger_entries" USING btree ("shop_id","occurred_at");--> statement-breakpoint
CREATE INDEX "orders_shop_id_placed_at_index" ON "orders" USING btree ("shop_id","placed_at");--> statement-breakpoint
CREATE INDEX "restock_lots_shop_id_item_id_index" ON "restock_lots" USING btree ("shop_id","item_id");