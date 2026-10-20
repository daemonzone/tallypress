<?php
// Creates a fixed, read-only WooCommerce REST key so Tallypress's .env can be committed for dev.

global $wpdb;

$ck = getenv('WC_CONSUMER_KEY');
$cs = getenv('WC_CONSUMER_SECRET');
$table = $wpdb->prefix . 'woocommerce_api_keys';
$hash = wc_api_hash($ck);

$exists = $wpdb->get_var($wpdb->prepare("SELECT key_id FROM {$table} WHERE consumer_key = %s", $hash));
if ($exists) {
    WP_CLI::log('API key already present.');
    return;
}

$inserted = $wpdb->insert($table, [
    'user_id'         => 1,
    'description'     => 'Tallypress (read-only)',
    'permissions'     => 'read',
    'consumer_key'    => $hash,
    'consumer_secret' => $cs, // char(43) column: longer secrets are rejected in strict mode
    'truncated_key'   => substr($ck, -7),
]);
if (!$inserted) {
    WP_CLI::error('Could not create API key: ' . $wpdb->last_error);
}
WP_CLI::success('API key created.');
