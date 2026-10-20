<?php
require_once '/scripts/lib.php';
// Demo clothing shop: 22% IVA included in prices, variable + simple products,
// and orders spread over the previous and current month in various statuses.

if (get_option('tallypress_seeded')) {
    WP_CLI::log('Already seeded.');
    return;
}

// No mail server in the dev stack; keep WooCommerce's order emails from spamming the log.
add_filter('pre_wp_mail', '__return_false');

update_option('woocommerce_calc_taxes', 'yes');
update_option('woocommerce_prices_include_tax', 'yes');
update_option('woocommerce_tax_based_on', 'base');
WC_Tax::_insert_tax_rate([
    'tax_rate_country'  => 'IT',
    'tax_rate_state'    => '',
    'tax_rate'          => '22.0000',
    'tax_rate_name'     => 'IVA',
    'tax_rate_priority' => 1,
    'tax_rate_compound' => 0,
    'tax_rate_shipping' => 1,
    'tax_rate_order'    => 1,
    'tax_rate_class'    => '',
]);

tp_variable_product('Wool Blazer', 'BLZ', ['S' => 129, 'M' => 129, 'L' => 135], 10);
tp_variable_product('Linen Shirt', 'SHT', ['M' => 59, 'L' => 59], 15);

$scarf = new WC_Product_Simple();
$scarf->set_name('Cashmere Scarf');
$scarf->set_sku('SCF');
$scarf->set_status('publish');
$scarf->set_regular_price('45');
$scarf->set_manage_stock(true);
$scarf->set_stock_quantity(20);
$scarf->save();

// [days ago, final status, [[sku, qty], ...], shipping (excl. tax)]
$orders = [
    [45, 'completed',  [['BLZ-M', 1], ['SCF', 1]], 4.10],
    [38, 'completed',  [['SHT-L', 2]],             4.10],
    [33, 'cancelled',  [['BLZ-S', 1]],             0],
    [20, 'completed',  [['BLZ-L', 1]],             4.10],
    [12, 'processing', [['SHT-M', 1], ['SCF', 2]], 0],
    [5,  'processing', [['BLZ-M', 2]],             4.10],
    [2,  'processing', [['SCF', 1]],               4.10],
    [1,  'completed',  [['SHT-L', 1], ['BLZ-S', 1]], 0],
];

foreach ($orders as [$daysAgo, $status, $items, $shipping]) {
    $order = wc_create_order();
    foreach ($items as [$sku, $qty]) {
        $order->add_product(wc_get_product(wc_get_product_id_by_sku($sku)), $qty);
    }
    $order->set_address([
        'first_name' => 'Demo', 'last_name' => 'Customer',
        'email' => 'customer@example.com', 'country' => 'IT',
        'city' => 'Milano', 'postcode' => '20100', 'address_1' => 'Via Roma 1',
    ], 'billing');
    $order->set_address(['country' => 'IT'], 'shipping');
    if ($shipping > 0) {
        $s = new WC_Order_Item_Shipping();
        $s->set_method_title('Flat rate');
        $s->set_method_id('flat_rate');
        $s->set_total($shipping);
        $order->add_item($s);
    }
    $order->set_date_created(strtotime("-{$daysAgo} days"));
    $order->calculate_totals(true);
    $order->save();
    $order->update_status($status);
    if ($status === 'completed') {
        $order->set_date_paid(strtotime("-{$daysAgo} days"));
        $order->set_date_completed(strtotime("-{$daysAgo} days"));
        $order->save();
    }
}

// One partial refund on the 20-days-ago blazer order, to exercise refund handling.
$refundable = wc_get_orders(['limit' => 1, 'status' => 'completed', 'orderby' => 'date', 'order' => 'ASC', 'offset' => 2]);
if ($refundable) {
    wc_create_refund([
        'order_id' => $refundable[0]->get_id(),
        'amount'   => 20,
        'reason'   => 'Seed: partial refund (damaged item)',
    ]);
}

update_option('tallypress_seeded', time());
WP_CLI::success('Seeded 3 products, 8 orders, 1 refund.');
