# Tallypress

Monthly sales, margin and cash tracking for WooCommerce shops. Multi-shop by design
(every table is scoped by `shop_id`); the MVP runs against one fixed shop.

## Local development

```bash
cp .env.example .env
docker compose up -d        # Postgres :9432, WordPress/WooCommerce :9080, MariaDB :9306
npm install
npm run db:migrate          # apply Drizzle migrations
npm run db:seed             # create the dev shop (DEFAULT_SHOP_ID)
npm run dev                 # http://localhost:9000
```

WooCommerce admin: http://localhost:9080/wp-admin (`admin` / `admin`).
The seeded demo catalog, orders and a read-only REST key are created by the `wp-setup`
container on first start.

## Layout

- `src/db/schema.ts`: Drizzle schema; `npm run db:generate` after changing it.
- `src/lib/shop.ts`: `getCurrentShopId()`, the single place that picks the active shop.
- `src/i18n/`: EN/IT dictionaries; locale = cookie, else the shop's default.
- `docker/wordpress/`: WooCommerce install and seed scripts for the dev stack.
