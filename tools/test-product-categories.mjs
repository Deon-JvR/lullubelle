import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isApprovedProductCategory, migrateCatalogueContent, migrateProductCategory, PRODUCT_CATEGORIES, validateProductCatalogue } from "../netlify/functions/_products.mjs";

const categories = JSON.parse(await readFile(new URL("../data/product-categories.json", import.meta.url), "utf8"));
const products = JSON.parse(await readFile(new URL("../data/products.json", import.meta.url), "utf8"));
const brands = JSON.parse(await readFile(new URL("../data/brands.json", import.meta.url), "utf8"));
const expected = [
  "Corrects, Gels and Lotions", "De-age Complex Treatments", "UVA/UVB Protection", "Glassglow Treatment Products",
  "HOCL Collection", "Prepare", "Rescue + Restore", "Serums and Face Oil", "Tinted Treatment Moisturisers",
  "Treatment Lip Care", "Treatment Masks", "Treatment Moisturisers", "Treatment Eye Care", "Pigmentation",
  "Acne and Breakouts", "Sensitive Skin Treatments",
];

assert.deepEqual(categories, expected);
assert.deepEqual(PRODUCT_CATEGORIES, expected);
assert.equal(new Set(categories).size, 16);
assert.ok(!categories.includes("All categories"));

const mappings = {
  "Correctors — Gels & Lotion": "Corrects, Gels and Lotions",
  "Effective UVA/UVB Protection": "UVA/UVB Protection",
  "Support Serums & Face Oil": "Serums and Face Oil",
  "Tinted Treatment Moisturisers & Phyto Fluid Foundation": "Tinted Treatment Moisturisers",
  "Treatments Eye Care": "Treatment Eye Care",
};
Object.entries(mappings).forEach(([legacy, approved]) => assert.equal(migrateProductCategory(legacy), approved));
assert.equal(migrateProductCategory("Cleaning Tools & Disposables"), "Cleaning Tools & Disposables");
assert.equal(migrateProductCategory("Needs review"), "Needs review");
const migrationFixture = Object.keys(mappings).map((category, index) => ({
  ...products.find((product) => product.category) || {}, id: `legacy-${index}`, sku: `LEGACY-${index}`, name: `Legacy ${index}`, category,
}));
migrationFixture.push({ ...migrationFixture[0], id: "ambiguous", sku: "AMBIGUOUS", name: "Ambiguous", category: "Cleaning Tools & Disposables" });
const migratedFixture = migrateCatalogueContent({ catalogueSchemaVersion: 4, products: migrationFixture }, { brands, products: [] }).content.products;
Object.values(mappings).forEach((category) => assert.ok(migratedFixture.some((product) => product.category === category)));
assert.equal(migratedFixture.find((product) => product.id === "ambiguous").category, "Cleaning Tools & Disposables");

const knownOldLabels = new Set(Object.keys(mappings));
assert.ok(!products.some((product) => knownOldLabels.has(product.category)));
const ambiguous = products.filter((product) => !isApprovedProductCategory(product.category));
assert.deepEqual([...new Set(ambiguous.map((product) => product.category || "(empty)"))].sort(), ["(empty)", "Cleaning Tools & Disposables", "Skincare Kits"]);

const validProduct = {
  id: "test-product", slug: "test-product", sku: "TEST-1", brandId: brands[0].id, brand: brands[0].name,
  name: "Test product", category: categories[0], price: 100, image: "products/kalahari/fk1000.webp",
};
const validContent = { brands, products: Array.from({ length: 65 }, (_, index) => ({ ...validProduct, id: `test-product-${index}`, slug: `test-product-${index}`, sku: `TEST-${index}` })) };
assert.equal(validateProductCatalogue(validContent), "");
for (const invalidCategory of ["", "All categories", "Unknown category"]) {
  const invalid = structuredClone(validContent);
  invalid.products[0].category = invalidCategory;
  assert.match(validateProductCatalogue(invalid), /Select an approved category/);
}
const legacy = structuredClone(validContent);
legacy.products[0].category = "Cleaning Tools & Disposables";
assert.equal(validateProductCatalogue(legacy, { existingProducts: legacy.products }), "");
const changedLegacy = structuredClone(legacy);
changedLegacy.products[0].category = "Needs review";
assert.match(validateProductCatalogue(changedLegacy, { existingProducts: legacy.products }), /not a valid product category/);

console.log(`Product category validation passed: ${categories.length} approved categories; ${ambiguous.length} ambiguous legacy products reported.`);
