import assert from "node:assert/strict";
import {
  CATALOGUE_SCHEMA_VERSION,
  isValidProductImageUrl,
  mergeProductCatalogue,
  migrateCatalogueContent,
  normaliseProductGallery,
  validateProductCatalogue,
  verifyPersistedProducts,
} from "../netlify/functions/_products.mjs";

const brands = ["Kalahari", "VitaDerm", "Mesoestetic", "SunSkin"].map((name, index) => ({
  id: name.toLowerCase(), name, order: index + 1, active: true,
}));
const product = (brand, index) => ({
  id: `test-${brand.id}-${index}`,
  brandId: brand.id,
  brand: brand.name,
  name: `${brand.name} Test Product ${index}`,
  price: 100 + index,
  image: `/.netlify/functions/admin-asset?key=products%2F${brand.id}%2Fmain-${index}.webp`,
  galleryImages: [
    { id: `image-${brand.id}-${index}-1`, url: `/.netlify/functions/admin-asset?key=products%2F${brand.id}%2Fgallery-${index}-1.webp`, alt: "Front" },
    { id: `image-${brand.id}-${index}-2`, url: `/.netlify/functions/admin-asset?key=products%2F${brand.id}%2Fgallery-${index}-2.webp`, alt: "Back" },
  ],
  description: "Preserve this unrelated field",
});

const products = brands.map((brand, index) => product(brand, index + 1));
const content = { brands, products };
assert.equal(validateProductCatalogue(content, { minimumProducts: 4 }), "");
products.forEach((item, index) => {
  assert.equal(item.brand, brands[index].name);
  assert.equal(item.brandId, brands[index].id);
  assert.equal(normaliseProductGallery(item).length, 2);
});

const textEdit = { ...products[1], name: "Edited VitaDerm Product" };
assert.equal(textEdit.image, products[1].image);
assert.deepEqual(textEdit.galleryImages, products[1].galleryImages);
assert.equal(textEdit.description, products[1].description);

const mainReplacement = { ...products[2], image: "/.netlify/functions/admin-asset?key=products%2Fmesoestetic%2Fmain-new.webp" };
assert.notEqual(mainReplacement.image, products[2].image);
assert.deepEqual(mainReplacement.galleryImages, products[2].galleryImages);
assert.equal(products[0].image.includes("kalahari"), true);

const galleryRemoval = { ...products[3], galleryImages: products[3].galleryImages.filter((image) => image.id !== "image-sunskin-4-1") };
assert.deepEqual(galleryRemoval.galleryImages.map((image) => image.id), ["image-sunskin-4-2"]);
assert.equal(products[3].galleryImages.length, 2);

const fallback = [{ ...products[0], brand: "Wrong fallback brand", image: "products/wrong.webp" }];
const merged = mergeProductCatalogue(fallback, products);
assert.equal(merged.find((item) => item.id === products[0].id).brand, "Kalahari");
assert.equal(merged.find((item) => item.id === products[0].id).image, products[0].image);

const partialManaged = [{ id: products[0].id, name: "Incomplete" }];
const partialMerge = mergeProductCatalogue(fallback, partialManaged);
assert.equal(partialMerge[0].brand, undefined, "A partial managed record must not inherit a fallback brand");
assert.match(validateProductCatalogue({ brands, products: partialMerge }, { minimumProducts: 1 }), /Select a valid brand/);

const duplicate = { ...products[1], id: products[0].id.toUpperCase() };
assert.match(validateProductCatalogue({ brands, products: [products[0], duplicate] }, { minimumProducts: 2 }), /Duplicate product ID/);
const slugCollision = { ...products[1], id: "test_kalahari_1" };
assert.match(validateProductCatalogue({ brands, products: [products[0], slugCollision] }, { minimumProducts: 2 }), /Duplicate product slug/);
const missingBrand = { ...products[0], brandId: "", brand: "" };
assert.match(validateProductCatalogue({ brands, products: [missingBrand] }, { minimumProducts: 1 }), /Select a valid brand/);
assert.equal(isValidProductImageUrl("lullubelle-logo.jpg"), false);
assert.equal(isValidProductImageUrl("blob:stale-preview"), false);
assert.equal(isValidProductImageUrl(products[0].image), true);
assert.equal(verifyPersistedProducts(content, JSON.parse(JSON.stringify(content))), "");

const legacyContent = {
  brands: [
    { id: "sunskin", name: "SunSkin Tinted SPF", active: true },
    { id: "soopa", name: "Soopa Skin", active: true },
  ],
  products: [
    { id: "soopa-valid", brandId: "soopa", brand: "Soopa Skin", name: "Valid product", category: "Care", price: 200, image: "products/soopa/valid.webp" },
    { id: "product_generated_placeholder", brandId: "sunskin", brand: "SunSkin Tinted SPF", name: "New product", category: "Needs review", price: 1, image: "lullubelle-logo.jpg" },
    { id: "product_real_new_product", brandId: "sunskin", brand: "SunSkin Tinted SPF", name: "New product", category: "Sun care", price: 250, image: "products/sunskin/new-product.webp" },
  ],
};
const canonicalSeed = {
  brands: [
    { id: "sunskin", name: "SunSkin", active: true },
    { id: "soopa", name: "Soopa", active: true },
  ],
};
const migration = migrateCatalogueContent(legacyContent, canonicalSeed);
assert.equal(migration.changed, true);
assert.equal(migration.content.catalogueSchemaVersion, CATALOGUE_SCHEMA_VERSION);
assert.deepEqual(migration.removedPlaceholderIds, ["product_generated_placeholder"]);
assert.deepEqual(migration.content.brands.map((brand) => brand.name), ["SunSkin", "Soopa"]);
assert.deepEqual(migration.content.products.map((item) => [item.id, item.brand]), [
  ["soopa-valid", "Soopa"],
  ["product_real_new_product", "SunSkin"],
]);
assert.equal(migrateCatalogueContent(migration.content, canonicalSeed).changed, false, "The migration must run only once so later Admin brand renames remain authoritative");

console.log("Product identity, brand, image, gallery, merge and persistence tests passed for Kalahari, VitaDerm, Mesoestetic and SunSkin.");
