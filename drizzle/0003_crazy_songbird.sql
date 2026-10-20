ALTER TABLE "items" ADD COLUMN "price" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "income_tax_brackets" jsonb;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "social_security_rate" numeric(5, 2) DEFAULT '0' NOT NULL;