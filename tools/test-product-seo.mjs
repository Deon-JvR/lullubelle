import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applyProductSeoMigration, migrateCatalogueContent, PRODUCT_CATEGORIES } from "../netlify/functions/_products.mjs";
import { renderProductHtml } from "../netlify/functions/product-page.mjs";
import { categorySeo, renderShopHtml } from "../netlify/functions/shop-page.mjs";

const production = JSON.parse(await readFile("/tmp/lullubelle-seo-production-before.json", "utf8"));
const priceBefore = JSON.parse(await readFile("reports/seo/product-price-before.json", "utf8"));
const priceAfter = JSON.parse(await readFile("reports/seo/product-price-after.json", "utf8"));
const audit = JSON.parse(await readFile("reports/seo/product-seo-audit.json", "utf8"));
const productionPageAudit = JSON.parse(await readFile("reports/seo/production-page-audit.json", "utf8"));
const seed = JSON.parse(await readFile("data/products.json", "utf8"));

assert.equal(production.products.length, 163, "the captured production catalogue remains the authoritative test set");
assert.equal(priceBefore.sha256, priceAfter.sha256, "price snapshot hashes must be identical");
assert.deepEqual(priceAfter.records, priceBefore.records, "no price, sale or discount field may change");

const corrected = production.products.map(applyProductSeoMigration);
assert.deepEqual(corrected.map(({ id }) => id), production.products.map(({ id }) => id), "managed-only products and ordering must remain intact");
assert.equal(new Set(corrected.map(({ id }) => id)).size, corrected.length, "stable product IDs must remain unique");
assert(corrected.every((product) => Array.isArray(product.categories) && product.categories.length));
assert(corrected.every((product) => product.categories.every((category) => PRODUCT_CATEGORIES.includes(category))));
assert(corrected.every((product) => Array.isArray(product.searchKeywords)), "search keywords must be structured arrays");

const titles = corrected.map((product) => product.seoTitle.trim().toLowerCase());
const descriptions = corrected.map((product) => product.seoDescription.trim().toLowerCase());
assert.equal(new Set(titles).size, corrected.length, "SEO titles must be unique");
assert.equal(new Set(descriptions).size, corrected.length, "meta descriptions must be unique");
assert(corrected.every((product) => product.seoTitle.includes("Lullubelle")));
assert(corrected.every((product) => product.seoDescription && !/\bR\s?\d|promo price|\bdiscount\b|\bin stock\b/i.test(product.seoDescription)));
assert(corrected.every((product) => product.imageAlt && !/^product image$/i.test(product.imageAlt)));

const migrated = migrateCatalogueContent({ ...production, catalogueSchemaVersion: 7 }, { ...production, products: seed });
assert.equal(migrated.content.products.length, production.products.length, "migration must preserve managed-only products");
assert(migrated.content.products.every((product) => !Object.hasOwn(product, "category")));
assert.deepEqual(migrated.content.products.map(({ id, price }) => ({ id, price })), production.products.map(({ id, price }) => ({ id, price })), "migration must preserve authoritative production prices exactly");

for (const product of corrected.filter((item) => item.hidden !== true && item.active !== false && item.published !== false)) {
  const html = renderProductHtml(product);
  const canonical = `https://www.lullubelle.co.za/products/${encodeURIComponent(product.slug || product.id)}`;
  const escapedName = String(product.name).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  assert(html.includes(`<h1>${escapedName}</h1>`));
  assert(html.includes(`<link rel="canonical" href="${canonical}">`));
  assert.equal((html.match(/<link\s+rel="canonical"/g) || []).length, 1, `${product.id} must have one canonical`);
  assert(!/<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html));
  assert.equal((html.match(/<h1>/g) || []).length, 1, `${product.id} must have one H1`);
  assert.equal((html.match(/data-server-product-schema/g) || []).length, 1, `${product.id} must have one Product node`);
  assert.equal((html.match(/data-server-breadcrumb-schema/g) || []).length, 1, `${product.id} must have one breadcrumb node`);
  const schemaText = html.match(/<script type="application\/ld\+json" data-server-product-schema>(.*?)<\/script>/)?.[1];
  const schema = JSON.parse(schemaText);
  assert.equal(schema["@type"], "Product");
  assert.equal(schema.offers.priceCurrency, "ZAR");
  assert.deepEqual(schema.offers.price, product.price, `${product.id} schema price must preserve its catalogue type and value`);
  assert.equal(schema.url, canonical);
  assert.equal(schema.offers.url, canonical);
  assert.equal(schema.sku, product.sku || product.id);
  assert.equal(schema.brand.name, product.brand);
  assert(schema.image.length && schema.image.every((image) => new URL(image).protocol === "https:"));
  for (const category of product.categories) assert(html.includes(`/shop?category=${encodeURIComponent(category)}`));
}

assert.equal(audit.summary.duplicateTitles.length, 0);
assert.equal(audit.summary.duplicateDescriptions.length, 0);
assert.equal(audit.summary.slugChanges.length, 0, "indexed URLs must not be changed automatically");
assert.equal(audit.summary.manualReviewPhase.reviewedProductIds.length, 33);
assert.equal(audit.summary.manualReviewPhase.resolvedProductIds.length, 33);
assert.deepEqual(audit.summary.manualReviewPhase.unresolvedProducts, []);
assert.equal(audit.summary.manualReviewPhase.descriptionChanges.length, 7);
assert.equal(audit.summary.manualReviewPhase.claimChanges.length, 2);

for (const id of audit.summary.manualReviewPhase.reviewedProductIds) {
  const before = production.products.find((item) => item.id === id);
  const after = corrected.find((item) => item.id === id);
  const pageAudit = productionPageAudit.productPages.find((item) => item.id === id);
  const expectedUrl = `https://www.lullubelle.co.za/products/${id}`;
  assert.equal(after.id, before.id);
  assert.equal(after.slug, before.slug);
  assert.equal(before.slug, undefined, `${id} must not emit an alternative slug`);
  assert.equal(pageAudit.canonical, expectedUrl);
  assert(!productionPageAudit.sitemap.missingProductIds.includes(id));
  assert(!productionPageAudit.sitemap.duplicateProductEntries.some((entry) => entry.id === id));
}

const cosmelan = corrected.find((item) => item.id === "product_mrnqx248_3bfaba");
assert(!/corrects pigmentation|fights visible ageing|prevent their recurrence|regulating excess melanin/i.test(`${cosmelan.benefit} ${cosmelan.description}`));
const skinretin = corrected.find((item) => item.id === "product_mrliqprw_8503d4");
assert(!/treat wrinkles|clinically|50%|70%|9\.8 times/i.test(`${skinretin.benefit} ${skinretin.description}`));

const categoryTitles = new Set();
const categoryDescriptions = new Set();
for (const category of PRODUCT_CATEGORIES) {
  const seo = categorySeo(category);
  const html = renderShopHtml({ products: corrected }, category);
  categoryTitles.add(seo.title);
  categoryDescriptions.add(seo.description);
  assert(html.includes(`<title>${seo.title}</title>`));
  assert(html.includes(`href="${seo.canonical}"`));
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert(html.includes(`<h1>${category} skincare products</h1>`));
  assert.equal((html.match(/data-server-category-breadcrumb/g) || []).length, 1);
  for (const product of corrected.filter((item) => item.hidden !== true && item.active !== false && item.published !== false && item.categories.includes(category))) {
    assert(html.includes(`/products/${encodeURIComponent(product.slug || product.id)}`));
  }
}
assert.equal(categoryTitles.size, PRODUCT_CATEGORIES.length);
assert.equal(categoryDescriptions.size, PRODUCT_CATEGORIES.length);

console.log(`Product SEO regression checks passed for ${corrected.length} production products.`);
