# Tallypress

Monthly sales, margin and cash tracking for WooCommerce shops.

Tallypress reads orders and products from a WooCommerce shop, lets the owner record what
the stock cost and what was taken out of the shop's money, and answers three questions
each month: **how much did we sell, how much did we really earn, and how much can I spend
on restocking and on myself?** It works for any kind of goods, not only clothes, and is
multi-shop by design.

> **Status: MVP, running locally.** Everything below marked "Done" has been exercised
> against the Docker WooCommerce shop. There are no automated tests yet. See
> [Known limitations](#known-limitations) and the [roadmap](#roadmap).

## What it does today

| Area | State |
|---|---|
| Sync from WooCommerce (products, variations, orders, refunds) | Done, incremental, safe to repeat |
| Purchase cost per item (moving average) frozen onto each sold line | Done |
| Monthly panel: orders, gross, VAT, net, cost of goods, income-tax reserve, net earnings | Done |
| Breakdown per product / variation, with shipping and refunds as a separate row | Done |
| Shop account (cash) per month with balance carried forward | Done |
| Automatic month closing with immutable snapshots | Done |
| Overview "up to date": cash, reserves, net earnings, invested, ROI | Done |
| Live owner-share simulator ("what can I spend?") | Done |
| Restock and withdrawal recording, manual cost for items without history | Done |
| Starting point ("zero time"): date, bank balance, opening stock and prices | Done |
| Italian and English UI, per-shop default language | Done |
| Authentication | Not yet (planned: Supabase) |
| Stock-change detection (find unrecorded restocks) | Not yet |
| Monthly expenses, the owner's own shipping costs | Not yet |

## The pages

- **Panel** (`/`, `/month/YYYY-MM`): two columns. On the left, the month: its name with an
  open/closed badge, month tabs, the net-earnings figure, a bar showing where the gross
  total goes (net earnings, cost of goods, VAT, income tax), net earnings by month, the
  gross-to-net detail, the shop account for the month and the per-product table. On the
  right, a sidebar that stays the same whichever month is open: the shop overview (money in
  the account, VAT and tax set aside, net earnings, withdrawals, stock value, invested,
  ROI) and the owner-share simulator with a live bar of where the account money goes.
- **Orders** (`/orders`): every order, newest first, 10 per page, with one search box that looks at
  the order number, the products sold, coupon codes, payment, channel, origin and status (also by
  their names in the current language). Columns: date and time on two lines, order, status, products
  (one per line, small), total and discount (right-aligned, refunds and coupon codes noted), payment
  and channel as icons (PayPal, Klarna, Satispay, Apple Pay, card, bank, entered by hand; app or
  website), and the origin as one word with a small icon (Instagram, Facebook, Google, Direct, App,
  Link), with the source and medium in the tooltip. Orders that do not count as sales
  (cancelled, failed...) are greyed out. First version: more filters and columns to come.
- **Stock** (`/stock`): one row per product (20 per page) with photo, name, product code (the parent SKU,
  if it has one), total quantity, average purchase cost and stock value; search on product, variation or
  code, or only the products whose quantity does not match WooCommerce. Click a row to see its
  variations (size/colour). A banner on top lists pieces that came in unrecorded: the quantity is
  read-only (found in WooCommerce) and only the total paid is entered, with or without VAT at a rate
  you can change; the unit cost is computed on the net, the gross is booked once in Movements (the bank
  figure) and the VAT it contained is deducted from the VAT due. The average moves only through that
  calculation. A
  "correction" adds the pieces at the current average cost without any money movement.
- **Ledger** (`/ledger`): every movement of the shop account, and one form to record any
  manual movement. The amount is always positive and the type decides the direction:
  deposit into the account (in), personal withdrawal, expense, VAT payment, income-tax /
  contributions payment, adjustment up or down, and "other" in or out (the description is
  required for "other"). Movements are booked today, so a closed month never changes.
  **VAT and tax payments settle what was set aside**: they lower the account but not the
  "left after taxes and costs" figure a second time, and the VAT / tax amounts still to pay
  shrink accordingly. Do not record them as expenses.
- **Setup** (`/setup`): shop tax profile, WooCommerce sync status and the "Sync now"
  button, and the one-time starting-point form.

The language switch (IT / EN) in the header changes the language on click and always shows
the active one. It sets a cookie; without one, the shop's default language is used.

## Look and feel

- Light and dark themes follow the system setting. Colours are tokens in
  `src/app/globals.css`; layout is responsive down to phone width (the sidebar moves below
  the month, the navigation collapses to icons, wide tables scroll inside their card).
- Charts are small server-rendered SVG/HTML components (`src/components/charts.tsx`) using a
  validated categorical palette, and each colour keeps one meaning everywhere: blue = what
  is yours (net earnings, money available to restock), orange = cost of goods, aqua = VAT,
  yellow = income tax, magenta = personal share. Every chart has a legend with the amounts
  as text, so colour is never the only channel.
- **Logo:** four tally strokes crossed by the fifth, on a blue tile; the wordmark pairs a
  bold "Tally" with a light "press". Files: `src/app/icon.svg` (favicon),
  `public/logo.svg` (mark + wordmark), `src/components/logo.tsx` (in the header).

## How the money is calculated

All figures are in the shop's currency (one currency per shop, locked once the starting
point exists) and are computed in integer cents.

**Which orders count.** Orders in status `processing` or `completed`, placed on or after
the shop's starting date. Cancelled, failed and refunded-status orders do not. Partial
refunds reduce the order's collected amount.

**Per month** (month boundaries follow the shop's timezone, `Europe/Rome` by default):

```
gross        = Σ (order total - refunded amount)          VAT included, shipping included
VAT          = gross × vat% / (100 + vat%)                from the shop's tax profile
net of VAT   = gross - VAT
cost of goods= Σ quantity × purchase cost frozen on the line
profit       = net of VAT - cost of goods
tax reserve  = income tax % × (profit, or net of VAT if the profile says "revenue")
net earnings = profit - tax reserve
```

The tax profile is a setting per shop: VAT %, how the income tax is computed, and whether
it applies to profit (ordinary regime: purchases are deductible) or to revenue (flat
regime). Income tax can be a flat rate, or **progressive yearly brackets** (for example
IRPEF 23% up to 28,000 €, 33% up to 50,000 €, 43% above) plus a flat **social-security**
percentage of profit (for example INPS 26.07%). With brackets, a month's reserve is the
extra tax that month's profit adds to the *calendar year so far*, so the brackets apply to
the yearly total and the monthly reserves add up exactly to the annual figure; a loss
month can release some reserve. Income tax is *set aside*, not paid: it shows up as a
reserve so the owner never counts it as spendable. The per-product rows get a share of the
month's reserve in proportion to their profit.

**Purchase cost: moving average.** Each item keeps restock lots (quantity, unit cost
without VAT). The average blends in at every purchase and a sale leaves it unchanged:
10 blazers at 10 €, 4 sold, 10 more at 12 € → 16 units, average
`(6 × 10 + 10 × 12) / 16 = 11.25`. When an order line is first costed, that unit cost is
**frozen** on the line, so a later restock never rewrites an earlier month. Items with no
purchase history can use a manual unit cost; a line with no cost at all is counted at 0
and the panel warns about it.

**Shop account and month closing.**

```
balance at end of month = balance carried in + sales collected
                          + restocks (negative) + withdrawals (negative)
                          + expenses (negative) + starting balance / adjustments
```

After a month ends, it is closed once: its figures and ending balance are stored and the
next month starts from that balance. Closing runs at the end of every sync (the cron
endpoint), and also lazily when the panel is opened, so a missed cron run never leaves a
month open. It is idempotent. If a closed month later changes in WooCommerce (a late
refund or order), the difference is not edited into the old month: it is booked as a
"late adjustment" in the first open month, and shown as such.

**The owner-share simulator.** Given a percentage of net earnings kept for personal use:

```
personal share       = pct × net earnings so far
still to take        = max(personal share - already withdrawn, 0)
available to restock = cash - VAT set aside - income tax set aside - still to take
```

Moving the slider recomputes instantly in the browser and writes nothing. "Save as
default" stores it on the shop. Real withdrawals are ledger entries.

**ROI** = net earnings so far ÷ invested, where invested = opening stock value + every
restock.

## Architecture

- **Next.js 16** (App Router), React 19, Tailwind 4, TypeScript, on **port 9000**, also
  packaged as a Docker image (standalone output, ~225 MB, non-root). Cache Components are
  off on purpose: every page reads live data.
- **Postgres** through **Drizzle ORM** (`pg` driver). Plain Postgres; no Timescale needed.
  Neon works with the same connection string.
- **WooCommerce REST API** (`wc/v3`) with a read-only key. WooCommerce is the source of
  truth for products and orders; the database is a synced copy plus Tallypress's own data
  (costs, ledger, closings). Direct reads of the WordPress database and the event store
  were considered and rejected for the MVP: the REST API is stable, safe to expose to a
  remote host, and carries refunds and statuses.
- **i18n** without a library: JSON dictionaries (`en`, `it`), the visitor's cookie wins,
  otherwise the shop's default language.
- **Multi-shop from the start:** every table below `shops` has a `shop_id`, uniqueness is
  per shop, and everything is scoped by `getCurrentShopId()` (`src/lib/shop.ts`). For the
  MVP it returns the fixed `DEFAULT_SHOP_ID`; later it can come from a route or a session.

### Data model (`src/db/schema.ts`)

| Table | Purpose |
|---|---|
| `shops` | Shop settings: WooCommerce URL and keys, currency, locale, timezone, tax profile, owner-share default, starting date, sync cursor/error |
| `items` | A sellable unit: a simple product or one variation; Woo stock; optional manual cost |
| `orders`, `order_lines` | Synced orders (all statuses) and their lines; `unit_cost_snapshot` is the frozen purchase cost |
| `restock_lots` | Purchases: quantity and unit cost; `opening` lots come from the starting point |
| `ledger_entries` | Manual money movements: starting balance, restocks, withdrawals, expenses, adjustments |
| `month_closings` | Immutable monthly snapshot: figures, adjustments and the balance carried forward |

### Code layout

```
src/
  app/                 pages: / , month/[month], stock, ledger, setup; api/cron/sync, api/health
  components/          dashboard, charts, simulator (client), nav, logo, icons, shared UI kit
  db/                  schema + client
  i18n/                dictionaries (en, it), locale lookup, language action
  lib/
    woo.ts             WooCommerce REST client (paging, auth)
    sync/              items + orders import, per-shop lock, "Sync now" action
    costs.ts           moving-average replay, cost freezing, stock state
    report.ts          monthly figures, cash balance, overview
    closing.ts         idempotent month closing
    money.ts           cents helpers, tax/net formulas, month keys
    actions.ts         server actions: restock, withdrawal, manual cost, share, starting point
    shop.ts            getCurrentShopId() / getCurrentShop()
docker/wordpress/      dev WooCommerce install and seed scripts
Dockerfile             multi-stage image: deps, build (also runs migrations), runner
drizzle/               SQL migrations
scripts/               dev seed (creates the dev shop)
```

## Running it

Requirements: Docker (and Node 24 only if you want to develop outside a container).

### Everything in Docker (one command)

```bash
cp .env.example .env
docker compose up -d
```

Open **http://localhost:9000**. The stack starts in order: Postgres, then `migrate`
(applies migrations and creates the dev shop if it does not exist; an existing shop is
never touched), then the app. The first start also installs WooCommerce and seeds a demo
shop, which takes a minute or two (it downloads WooCommerce). `docker compose ps` shows
the app as `healthy` when it is ready.

Then open **Setup**, press **Sync now**, and fill in the starting point (date, bank balance
and a purchase price for each item; quantities are pre-filled from WooCommerce). The panel
appears once that is saved.

After changing the code: `docker compose up -d --build app`.

### Developing on the host instead

Run the backing services in Docker and the app with Node:

```bash
cp .env.example .env
docker compose up -d postgres wordpress wp-db wp-setup
npm install
npm run db:migrate && npm run db:seed
npm run dev               # http://localhost:9000 (stop the app container first)
```

| Service | URL |
|---|---|
| Tallypress | http://localhost:9000 |
| WooCommerce shop / admin | http://localhost:9080 , `/wp-admin` (`admin` / `admin`) |
| Postgres (Tallypress) | `postgres://tallypress:tallypress@localhost:9432/tallypress` |
| MariaDB (WordPress) | `mysql://wordpress:wordpress@localhost:9306/wordpress` (root / `root`) |

All host ports are 9000 or above and can be changed in `.env`.

The shop is saved with the address you use in a browser (`http://localhost:9080`). Inside
the app container that address is not reachable, so compose sets
`WOO_URL_REWRITE=http://localhost:9080=http://wordpress` to map it to the internal one.

The `wp-setup` container installs WooCommerce on first start and seeds a demo shop: IVA
22% included in prices, variable and simple products, orders in several statuses across
two months, and one partial refund. It also creates a fixed read-only REST key (dev only).
To add more demo products and an order (idempotent by SKU):

```bash
docker compose run --rm --no-deps -T --entrypoint sh wp-setup \
  -c 'wp --path=/var/www/html eval-file /scripts/add-products.php'
```

`docker compose down -v` wipes everything (including your Tallypress data); `up -d`
rebuilds it from scratch.

### Useful commands

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Dev server, production build, production server (port 9000) |
| `npm run db:generate` | Create a migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Create the dev shop if missing (never overwrites) |
| `npm run typecheck` / `lint` | Type-check (generates route types first) / ESLint |

### Connecting a real shop

`npm run shop:connect` points the shop at a real WooCommerce site. It **erases the shop's data in
Tallypress** (never the WooCommerce site: the key is read-only), stores the connection and
tax profile, syncs everything since the start date, then records the starting point: bank
balance, opening stock (WooCommerce's current stock plus what sold since the start date) and
a purchase cost for each item, derived as a percentage of its selling price without VAT.
Credentials are read from the environment only.

```bash
SHOP_URL=https://example.com SHOP_KEY=ck_... SHOP_SECRET=cs_... \
SHOP_NAME="My Shop" SHOP_START=2026-10-01 SHOP_BALANCE=2000 SHOP_COST_PCT=30 SHOP_WIPE=yes \
SHOP_TAX='{"vatRate":22,"brackets":[{"upTo":28000,"rate":23},{"upTo":50000,"rate":33},{"upTo":null,"rate":43}],"socialRate":26.07,"taxBase":"profit"}' \
npm run shop:connect
```

Without `SHOP_WIPE=yes` it refuses to run on a shop that already has data. Optional:
`SHOP_LOCALE` (`it`/`en`), `SHOP_TZ`, `SHOP_OWNER_PCT`. The currency is read from the shop.
Real costs can later replace the estimates on the Stock page.

### Importing a period (without erasing anything)

`npm run shop:import-range` brings in the orders of a period and leaves everything else alone.
The same thing is available on the **Setup** page ("Import a period"). Products are not re-read
from the shop, so the shop must already have been connected and synced.

```bash
npm run shop:import-range -- --from 2026-09-01                       # back to where the history begins
npm run shop:import-range -- --from 2026-09-01 --to 2026-09-30
npm run shop:import-range -- --from 2026-08-01 --rebuild-closings     # may go back before closed months
npm run shop:import-range -- --from 2022-01-01 --history-only         # older sales, without cash or stock
```

- A period inside the existing history just refreshes those orders.
- **`--history-only`** (checkbox "Sales history only" on Setup) adds older orders as *sales history*:
  the starting date, the opening deposit, the opening stock and the closed months are untouched.
  Those months show orders, VAT, cost of goods, tax and net earnings with a "Sales history" badge
  and **no account balance**, and they stay out of the overview (cash, reserves, ROI). Costs of
  history lines come from the item's cost estimate (no stock is tracked before the starting date).
- A period that starts **before** the starting date extends the cash history backwards: the starting
  date and the opening deposit move to `from`, and the opening stock is rebuilt for that date
  (WooCommerce stock now + units sold since, minus restocks you recorded). Costs already frozen
  on existing lines are kept.
- It must reach the existing history (no gap), and it refuses when months are already closed
  unless `--rebuild-closings` is given, because closed months would no longer add up; with the
  flag the closed months are recalculated from the data.
- Checked against an import made directly from the earlier date: orders, opening stock, the
  opening deposit and the closed month came out identical.

### Syncing and closing from outside

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:9000/api/cron/sync
```

Syncs every active shop (products, then orders), gives new sales their cost, and closes any
finished month. `GET` works too, for Vercel Cron. Without the secret it answers 401.

### Environment

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `DEFAULT_SHOP_ID` | The shop every request is scoped to for now |
| `CRON_SECRET` | Bearer token for `/api/cron/sync` |
| `DEV_WOO_URL`, `DEV_WOO_CONSUMER_KEY`, `DEV_WOO_CONSUMER_SECRET` | Used only by `db:seed` |
| `WOO_URL_REWRITE` | `<public url>=<internal url>`: how the app reaches WooCommerce from inside Docker |
| `APP_PORT`, `WP_PORT`, `WP_DB_PORT`, `TALLYPRESS_DB_PORT` | Host ports of the Docker services (all 9000+) |

## Aligning to the bank

The shop account starts from the opening deposit (a placeholder such as 1 EUR when the real balance
at the starting date is not known) and then follows sales and recorded movements, so until it is
aligned with the real bank balance its figures are **provisional**: the sidebar says so, and a
shortfall in the spending simulator is shown calmly instead of in red. On **Movements**, "Align to the
bank balance" takes one number, the real balance today, and records the difference as an adjustment
(booked today). The notice disappears once a real adjustment exists. Re-running the estimates changes
the computed balance, so align after the estimates are in place.

## Estimated purchases, VAT and taxes

WooCommerce knows what comes in, not what leaves the account. Until the real movements are
recorded, `npm run shop:estimate-restocks` fills the gap with **estimates**, marked as such
(a row per month in the shop account, "Estimated goods purchases", "VAT paid (estimated)",
"Income tax and contributions paid (estimated)"):

- **Purchases:** each month the shop is assumed to have bought back what it sold, so the estimated
  purchase is the month's cost of goods sold (the cost itself is `default_cost_pct` of the list price
  without VAT). The opening stock is then rebuilt (it shrinks to about today's stock) and every
  cost and closed month recomputed.
- **VAT and taxes:** each month's VAT is paid **in the following month** (so the latest month's VAT is
  still due; January pays the VAT of the last month before the starting point). Income tax and
  contributions are paid with a delay: the tax of the previous year (IRPEF brackets over the calendar
  year, plus INPS, from the sales history) comes out in **two equal instalments, June and November**,
  and the tax accruing in the current year is not paid yet, so it stays "still to pay". Payments for
  periods before the starting point have their own type ("VAT / taxes for an earlier period") and
  never settle what is set aside now. VAT on purchases is left out: it would raise the purchase
  outflow and lower the VAT payment by the same amount.

Re-running replaces the previous estimates (`--purchases-only` skips VAT and taxes, `--remove`
takes them all out). Recorded movements are never touched, and "left after taxes and costs" only
subtracts the cost of goods sold that has not been bought back yet, so nothing is counted twice.
These are approximations of steady state: real purchases come in waves and taxes are paid with a
delay. Replace them with the real movements as you record them.

## What is kept from an order

Besides amounts, status, date and lines, each order stores **how it was paid and where it came
from**: the payment method (gateway id, e.g. `ppcp-gateway`, `stripe_cc`, `satispay`; empty for orders
entered by hand) with its label, the processor's transaction id, the channel it was created through
(`checkout`, `rest-api` for the mobile app, `admin`), the visit origin from WooCommerce's order
attribution (type such as `utm`, `organic`, `referral`, `typein`, `mobile_app`; source and medium),
and the coupons used (`order_coupons`, one row per code, plus the order's total discount). Nothing
about the customer is stored, and card digits in a payment label ("MasterCard ending in 2163") are
dropped. Payment fees are not modelled yet. Orders imported before these fields existed get them on
the next refresh (`npm run shop:import-range -- --from <date>`).

## Products that are gone from the shop

Order lines keep the WooCommerce product and variation they were sold under. Products the
shop has since **trashed** (and their variations) are brought into the catalogue with status
"trash" and no stock, so sold lines stay linked; ones **deleted for good** are recorded as
"deleted" when WooCommerce still knows the id. WooCommerce also drops the product link of a
line when a product is deleted for good (id 0): those lines are listed by the name they were
sold under, marked "Deleted". Every counted line gets a purchase cost: from the item's estimate
(`default_cost_pct` of its price without VAT) or, with no item, of the line's own price.

## Known limitations

These are deliberate MVP simplifications or gaps, not hidden behaviour.

- **No authentication.** Anyone who can reach the app can read and edit the books. Fine on
  localhost; add auth (Supabase is planned) before any public deployment. Access checks are
  centred on `getCurrentShopId()`.
- **Secrets in the database.** WooCommerce keys are stored as plain text per shop. Encrypt
  them or use a secrets store before hosting.
- **Restocks and withdrawals are booked "now".** There is no date field, so a closed month
  is never edited after the fact.
- **VAT comes from the shop's tax profile**, not from WooCommerce's per-order tax figures.
  VAT paid on purchases is not tracked (purchase prices are entered without VAT) and
  neither are payments of VAT or income tax: the reserves simply accumulate.
- **Refunds reduce the collected amount only.** They do not reduce the cost of goods or put
  stock back, and per-variation rows are shown before refunds (refunds land in the
  "shipping, refunds and adjustments" row).
- **The tax reserve is an estimate, not a tax return.** It applies the bracket and
  contribution rates you configure to profit from the start date (not the whole year, if you
  start mid-year) and ignores deductions, minimum contributions and the deductibility of
  social contributions. Confirm the figures with an accountant.
- **Late changes to closed months** are folded into the first open month as an adjustment
  of the collected amount; their effect on cost of goods is not recomputed.
- **Products are re-read in full on every sync** (cheap, idempotent, no duplicates);
  orders are incremental.
- **Stock changes are not detected automatically.** The Stock page flags differences
  between tracked and WooCommerce stock, but you record restocks yourself.
- **No automated tests.** Behaviour was verified by hand against the Docker shop; the cost
  and money logic is pure and ready to unit-test.
- **Single shop in the UI.** The schema supports many; selecting between them is not built.

## Roadmap

1. Detect unexplained stock increases and offer them as restock / return / correction.
2. Monthly expenses and the owner's own shipping costs.
3. Unit tests for `costs.ts`, `money.ts` and the report maths; an end-to-end check.
4. Authentication (Supabase), encrypted shop credentials, shop selector.
5. Vercel deployment on Neon, with `vercel.ts` cron for `/api/cron/sync`.
6. Optional: payment confirmation from the event store, payment fees, ordinary-regime VAT
   on purchases.

## Returns

When a refund puts items back in stock, WooCommerce writes a note on the order ("Item #123 stock increased
from 1 to 3."). The sync reads those notes for orders that have refunds and records the units on the order
line (`returned_qty`): a returned unit is not a sale, so stock and cost of goods sold both follow, and the
panel does not ask about it. A refund without restocking leaves no note and changes nothing; a cancelled
order is not counted as a sale at all. `npm run shop:returns` does the same for every refunded order
already imported (read-only against the shop), then recomputes costs and months. Differences between
WooCommerce and the tracked stock that nobody has classified yet survive that recomputation.

## Moving the starting point

`START_DATE=2026-10-20 START_BALANCE=0 CONFIRM=yes npm run shop:restart` moves the starting point ("zero time")
to a new day with the real bank balance of that day (without `CONFIRM=yes` it only lists what would go).
Sales are never touched. Everything dated before the new start is removed: ledger entries (estimated
purchases, VAT and tax payments included), stock lots and month closings; the opening stock is recomputed at
that date from WooCommerce, and the months before it become sales history. Entries and restocks on or after
it are kept, and so are the stock differences nobody has classified yet. A starting day in mid-month is
supported: that month counts only the sales from that day. Income tax is computed on the profit of the whole
calendar year; when the data starts after 1 January, a warning on the overview and on the month says that
the earlier months of that year are estimated and not in the cash balances.

## Estimated VAT and tax payments

`npm run shop:estimate-payments` books the VAT and income tax payments the owner has not recorded, from the
months as they stand (purchases are not touched; `-- --remove` takes them out again). VAT follows the shop's
`vat_period`: `monthly` (the month after the sales) or `quarterly` (16 May for Q1, 20 August for Q2, 16 November
for Q3, 16 March of the next year for Q4; the quarter before the starting point is booked as a payment for an
earlier period). Income tax and contributions for year Y-1 come out in two instalments, 30 June and 30 November
of year Y. A due date still in the future, or before the starting point, is not booked: it stays "still to pay".

## Income tax and contributions

The yearly tax is the contributions (flat percent of profit, e.g. INPS) plus the progressive income tax (e.g. IRPEF)
on the profit. With `social_deductible` (the default) the contributions are deducted from the income the
brackets apply to, as INPS is for IRPEF. The reserve of a month is the extra tax that month's profit adds to the
year so far. Local surcharges, contribution minimums and ceilings are not modelled.
