#!/bin/sh
set -eu

WP="wp --path=/var/www/html"

echo "[setup] waiting for WordPress files and database..."
until [ -f /var/www/html/wp-config.php ]; do sleep 2; done
until $WP db query 'SELECT 1' >/dev/null 2>&1; do sleep 3; done

if ! $WP core is-installed >/dev/null 2>&1; then
  echo "[setup] installing WordPress"
  $WP core install \
    --url="$WP_URL" \
    --title="Tallypress Demo Shop" \
    --admin_user=admin \
    --admin_password=admin \
    --admin_email=admin@example.com \
    --skip-email
fi

$WP rewrite structure '/%postname%/'
$WP rewrite flush --hard >/dev/null 2>&1 || true

if ! $WP plugin is-installed woocommerce; then
  echo "[setup] installing WooCommerce"
  $WP plugin install woocommerce
fi
$WP plugin activate woocommerce

$WP option update woocommerce_currency EUR
$WP option update woocommerce_default_country IT
$WP option update woocommerce_coming_soon no
$WP option update woocommerce_manage_stock yes

echo "[setup] creating read-only API key"
$WP eval-file /scripts/api-keys.php

echo "[setup] seeding demo catalog and orders"
$WP eval-file /scripts/seed.php

echo "[setup] done. Shop: $WP_URL  Admin: $WP_URL/wp-admin (admin / admin)"
echo "[setup] REST: consumer key $WC_CONSUMER_KEY"
