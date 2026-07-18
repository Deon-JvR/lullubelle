import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CATALOGUE_SCHEMA_VERSION, isApprovedProductCategory, MANAGED_PRODUCT_CATEGORY_REASSIGNMENTS, migrateCatalogueContent, migrateProductCategory, normaliseProductCategories, PRODUCT_CATEGORIES, validateProductCatalogue } from "../netlify/functions/_products.mjs";

const categories = JSON.parse(await readFile(new URL("../data/product-categories.json", import.meta.url), "utf8"));
const products = JSON.parse(await readFile(new URL("../data/products.json", import.meta.url), "utf8"));
const brands = JSON.parse(await readFile(new URL("../data/brands.json", import.meta.url), "utf8"));
const expected = [
  "Correcting Gels", "Anti-Aging", "UVA/UVB Protection", "HOCL Collection", "Prepare",
  "Serums and Face Oil", "Tinted SPF", "Treatment Lip Care", "Treatment Masks",
  "Treatment Moisturisers", "Treatment", "Pigmentation", "Acne and Breakouts",
  "Sensitive Skin Treatments", "Hydration",
];

assert.deepEqual(categories, expected);
assert.deepEqual(PRODUCT_CATEGORIES, expected);
assert.equal(new Set(categories).size, 15);
for (const removed of ["Rescue and Restore", "Rescue + Restore", "Glassglow Treatment Products"]) assert.ok(!categories.includes(removed));

const mappings = {
  "Correct Gels and Lotions": "Correcting Gels",
  "Corrects, Gels and Lotions": "Correcting Gels",
  "De-Age Complex Treatments": "Anti-Aging",
  "De-age Complex Treatments": "Anti-Aging",
  "Tinted Treatment Moisturiser": "Tinted SPF",
  "Tinted Treatment Moisturisers": "Tinted SPF",
  "Treatment Eye Care": "Treatment",
};
Object.entries(mappings).forEach(([legacy, approved]) => assert.equal(migrateProductCategory(legacy), approved));

assert.equal(products.length, 130);
assert.ok(products.every((product) => !Object.hasOwn(product, "category")));
assert.ok(products.every((product) => Array.isArray(product.categories) && product.categories.length));
assert.ok(products.every((product) => product.categories.every(isApprovedProductCategory)));
assert.ok(products.some((product) => product.categories.length > 1));

const legacyProduct = { ...products[0], id: "legacy", sku: "LEGACY", categories: undefined, category: "Treatment Eye Care" };
const migrated = migrateCatalogueContent({ catalogueSchemaVersion: 5, products: [legacyProduct] }, { brands, products: [] }).content.products[0];
assert.deepEqual(migrated.categories, ["Treatment"]);
assert.ok(!Object.hasOwn(migrated, "category"));
assert.deepEqual(normaliseProductCategories({ category: "Tinted Treatment Moisturiser" }), ["Tinted SPF"]);
for (const [id, expectedCategories] of Object.entries(MANAGED_PRODUCT_CATEGORY_REASSIGNMENTS)) {
  const reviewed = migrateCatalogueContent({ catalogueSchemaVersion: CATALOGUE_SCHEMA_VERSION - 1, products: [{ ...products[0], id, categories: [] }] }, { brands, products: [] }).content.products[0];
  assert.deepEqual(reviewed.categories, expectedCategories);
}

const validProduct = {
  id: "test-product", slug: "test-product", sku: "TEST-1", brandId: brands[0].id, brand: brands[0].name,
  name: "Test product", categories: [categories[0], categories[1]], price: 100, image: "products/kalahari/fk1000.webp",
};
const validContent = { brands, products: Array.from({ length: 65 }, (_, index) => ({ ...validProduct, id: `test-product-${index}`, slug: `test-product-${index}`, sku: `TEST-${index}` })) };
assert.equal(validateProductCatalogue(validContent), "");
for (const invalidCategories of [[], ["All categories"], ["Unknown category"]]) {
  const invalid = structuredClone(validContent);
  invalid.products[0].categories = invalidCategories;
  assert.match(validateProductCatalogue(invalid), /approved category/);
}
const retiredField = structuredClone(validContent);
retiredField.products[0].category = categories[0];
assert.match(validateProductCatalogue(retiredField), /retired single category field/);

console.log(`Product category validation passed: ${categories.length} approved categories; ${products.length} products use category arrays.`);
