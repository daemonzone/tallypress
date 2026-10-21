CREATE TABLE "product_costs" (
	"shop_id" uuid NOT NULL,
	"woo_product_id" bigint NOT NULL,
	"unit_cost" numeric(14, 4) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_costs_shop_id_woo_product_id_pk" PRIMARY KEY("shop_id","woo_product_id")
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "product_sku" text;--> statement-breakpoint
ALTER TABLE "product_costs" ADD CONSTRAINT "product_costs_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;