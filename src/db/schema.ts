import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// Money is numeric(14,2) in the shop currency; unit costs keep 4 decimals so
// averages don't drift. Quantities are numeric to allow weight/length goods.
// Every table below `shops` carries shop_id: Tallypress is multi-shop from day one.

export const locales = ["en", "it"] as const;
export type Locale = (typeof locales)[number];

export const taxBases = ["revenue", "profit"] as const;

export const shops = pgTable("shops", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),

  wooUrl: text("woo_url").notNull(),
  // TODO(before Vercel): encrypt at rest or move to a secrets store.
  wooConsumerKey: text("woo_consumer_key").notNull(),
  wooConsumerSecret: text("woo_consumer_secret").notNull(),

  // Locked once baseline_at is set; enforced in application code.
  currency: char("currency", { length: 3 }).notNull(),
  defaultLocale: text("default_locale", { enum: locales }).notNull().default("en"),
  timezone: text("timezone").notNull().default("Europe/Rome"),

  // Tax profile, e.g. ordinario = 22 / 56 on profit, forfettario = 0 / 15 on revenue.
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("22"),
  incomeTaxRate: numeric("income_tax_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  taxBase: text("tax_base", { enum: taxBases }).notNull().default("profit"),

  // Default for the live simulator on the panel; the slider itself never writes here.
  ownerSharePct: numeric("owner_share_pct", { precision: 5, scale: 2 }).notNull().default("0"),

  // "Zero time": orders before this instant are ignored.
  baselineAt: timestamp("baseline_at", { withTimezone: true }),

  // Set only when a sync run completes; the next incremental sync starts from here.
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastSyncError: text("last_sync_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A sellable unit: a simple product, or one variation of a variable product.
export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    wooProductId: bigint("woo_product_id", { mode: "number" }).notNull(),
    wooVariationId: bigint("woo_variation_id", { mode: "number" }).notNull().default(0), // 0 = simple
    productName: text("product_name").notNull(),
    variationLabel: text("variation_label"),
    sku: text("sku"),
    managesStock: boolean("manages_stock").notNull().default(false),
    stockQty: numeric("stock_qty", { precision: 14, scale: 3 }),
    // For items without restock lots (e.g. stock not managed): flat manual cost.
    manualUnitCost: numeric("manual_unit_cost", { precision: 14, scale: 4 }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.shopId, t.wooProductId, t.wooVariationId)],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    wooOrderId: bigint("woo_order_id", { mode: "number" }).notNull(),
    status: text("status").notNull(),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull(),
    grossTotal: numeric("gross_total", { precision: 14, scale: 2 }).notNull(), // tax included
    taxTotal: numeric("tax_total", { precision: 14, scale: 2 }).notNull(),
    shippingTotal: numeric("shipping_total", { precision: 14, scale: 2 }).notNull().default("0"),
    refundedTotal: numeric("refunded_total", { precision: 14, scale: 2 }).notNull().default("0"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.shopId, t.wooOrderId),
    index().on(t.shopId, t.placedAt),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    wooLineId: bigint("woo_line_id", { mode: "number" }).notNull(),
    itemId: uuid("item_id").references(() => items.id),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    grossTotal: numeric("gross_total", { precision: 14, scale: 2 }).notNull(),
    taxTotal: numeric("tax_total", { precision: 14, scale: 2 }).notNull(),
    // Frozen once computed so closed months never move. NULL = cost not known yet.
    unitCostSnapshot: numeric("unit_cost_snapshot", { precision: 14, scale: 4 }),
  },
  (t) => [unique().on(t.shopId, t.orderId, t.wooLineId)],
);

export const restockLots = pgTable(
  "restock_lots",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => items.id),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 14, scale: 4 }).notNull(), // net of VAT
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull(),
    source: text("source", { enum: ["opening", "restock", "return"] }).notNull().default("restock"),
    note: text("note"),
  },
  (t) => [index().on(t.shopId, t.itemId)],
);

export const ledgerKinds = pgEnum("ledger_kind", [
  "opening_balance",
  "restock",
  "withdrawal",
  "expense",
  "adjustment",
]);

// Manual money movements of the shop "bank". Sales come from orders, not from here.
// amount > 0 = money in, amount < 0 = money out.
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    kind: ledgerKinds("kind").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    restockLotId: uuid("restock_lot_id").references(() => restockLots.id),
    note: text("note"),
  },
  (t) => [index().on(t.shopId, t.occurredAt)],
);

// Immutable once written. `month` is the first day of the month in the shop timezone.
export const monthClosings = pgTable(
  "month_closings",
  {
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    month: date("month").notNull(),
    ordersCount: integer("orders_count").notNull(),
    grossTotal: numeric("gross_total", { precision: 14, scale: 2 }).notNull(),
    // Late changes (refunds, orders) to earlier closed months, folded into this one.
    adjustments: numeric("adjustments", { precision: 14, scale: 2 }).notNull().default("0"),
    vatTotal: numeric("vat_total", { precision: 14, scale: 2 }).notNull(),
    cogsTotal: numeric("cogs_total", { precision: 14, scale: 2 }).notNull(),
    taxReserve: numeric("tax_reserve", { precision: 14, scale: 2 }).notNull(),
    netTotal: numeric("net_total", { precision: 14, scale: 2 }).notNull(),
    // Carried into the next month's starting balance.
    balance: numeric("balance", { precision: 14, scale: 2 }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.month] })],
);
