import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const productsPath = new URL("../data/products.json", import.meta.url);
const overridesPath = new URL("../data/product-seo-overrides.json", import.meta.url);
const products = JSON.parse(await readFile(productsPath, "utf8"));
const migration = JSON.parse(await readFile(overridesPath, "utf8")).products || {};
const commerceKeys = ["sku", "price", "retailPrice", "salePrice", "compareAtPrice", "compareAt", "discount", "discountValue", "discountAmount", "discountPercent", "stock", "stockValue", "stockQuantity", "quantity", "inventory", "stockStatus"];
const commerceSnapshot = (items) => items.map((product) => ({
  id: product.id,
  ...Object.fromEntries(commerceKeys.map((key) => [key, Object.hasOwn(product, key) ? { present: true, value: product[key] } : { present: false }])),
}));
const before = commerceSnapshot(products);
const migrated = products.map((product) => {
  const correction = migration[product.id];
  if (!correction) throw new Error(`Missing production SEO correction for static product ${product.id}`);
  return {
    ...product,
    ...(correction.description ? { description: correction.description } : {}),
    ...(correction.benefit ? { benefit: correction.benefit } : {}),
    seoTitle: correction.seoTitle,
    seoDescription: correction.seoDescription,
    imageAlt: correction.imageAlt,
    searchKeywords: correction.searchKeywords,
    ...(correction.galleryImages ? { galleryImages: correction.galleryImages } : {}),
  };
});
assert.deepEqual(commerceSnapshot(migrated), before, "Static catalogue commerce data changed during SEO migration");
await writeFile(productsPath, `${JSON.stringify(migrated, null, 2)}\n`);
console.log(`Applied SEO-only corrections to ${migrated.length} static products; commerce fields are exactly equal.`);
