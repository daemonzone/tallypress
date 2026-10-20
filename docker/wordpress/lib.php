<?php
// Shared helpers for the dev seed scripts.

function tp_size_attribute(array $sizes): WC_Product_Attribute {
    $a = new WC_Product_Attribute();
    $a->set_name('Size');
    $a->set_options($sizes);
    $a->set_visible(true);
    $a->set_variation(true);
    return $a;
}

function tp_variable_product(string $name, string $sku, array $priceBySize, int $stock): void {
    $p = new WC_Product_Variable();
    $p->set_name($name);
    $p->set_sku($sku);
    $p->set_status('publish');
    $p->set_attributes([tp_size_attribute(array_keys($priceBySize))]);
    $id = $p->save();

    foreach ($priceBySize as $size => $price) {
        $v = new WC_Product_Variation();
        $v->set_parent_id($id);
        $v->set_attributes(['size' => $size]);
        $v->set_sku("{$sku}-{$size}");
        $v->set_regular_price((string) $price);
        $v->set_manage_stock(true);
        $v->set_stock_quantity($stock);
        $v->save();
    }
    WC_Product_Variable::sync($id);
}

/** Simple product; pass null stock for a product whose stock isn't managed. */
function tp_simple_product(string $name, string $sku, float $price, ?int $stock): void {
    $p = new WC_Product_Simple();
    $p->set_name($name);
    $p->set_sku($sku);
    $p->set_status('publish');
    $p->set_regular_price((string) $price);
    if ($stock !== null) {
        $p->set_manage_stock(true);
        $p->set_stock_quantity($stock);
    }
    $p->save();
}
