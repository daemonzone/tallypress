<?php
// Adds more demo products (and one order) to an already-seeded shop. Idempotent by SKU:
//   docker compose run --rm --no-deps -T --entrypoint sh wp-setup \
//     -c 'wp --path=/var/www/html eval-file /scripts/add-products.php'
require_once '/scripts/lib.php';
add_filter('pre_wp_mail', '__return_false');

$added = [];

if (!wc_get_product_id_by_sku('DNJ')) {
    tp_variable_product('Denim Jacket', 'DNJ', ['M' => 99, 'L' => 99, 'XL' => 105], 8);
    $added[] = 'Denim Jacket (3 variations)';
}
if (!wc_get_product_id_by_sku('SLD')) {
    tp_variable_product('Silk Dress', 'SLD', ['S' => 149, 'M' => 149], 5);
    $added[] = 'Silk Dress (2 variations)';
}
if (!wc_get_product_id_by_sku('BLT')) {
    tp_simple_product('Leather Belt', 'BLT', 39, 12);
    $added[] = 'Leather Belt';
}
if (!wc_get_product_id_by_sku('SOX')) {
    tp_simple_product('Cotton Socks 3-pack', 'SOX', 12, null); // stock not managed
    $added[] = 'Cotton Socks 3-pack (no stock management)';
}

// One order on a new product, once, so line -> item mapping is exercised.
if (!get_option('tallypress_add_products_order') && ($id = wc_get_product_id_by_sku('DNJ-L'))) {
    $order = wc_create_order();
    $order->add_product(wc_get_product($id), 1);
    $order->set_address([
        'first_name' => 'Demo', 'last_name' => 'Customer', 'email' => 'customer@example.com',
        'country' => 'IT', 'city' => 'Roma', 'postcode' => '00100', 'address_1' => 'Via Appia 2',
    ], 'billing');
    $order->calculate_totals(true);
    $order->save();
    $order->update_status('processing');
    update_option('tallypress_add_products_order', $order->get_id());
    $added[] = 'Order #' . $order->get_id() . ' (Denim Jacket L)';
}

WP_CLI::success($added ? 'Added: ' . implode(', ', $added) : 'Nothing to add, already present.');
