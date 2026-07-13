import { createHash } from "node:crypto";

const PLACEHOLDER_IMAGE_PATTERN = /(?:^|\/)(?:lullubelle-logo|placeholder|default-product|sample-product)(?:[._/?-]|$)/i;
const PRODUCT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
export const CATALOGUE_SCHEMA_VERSION = 4;

export const productIdentityKey = (value) => String(value || "").trim().toLowerCase();

export const productSlugKey = (value) => productIdentityKey(value)
  .replace(/&/g, "and")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

export const catalogueSeedSignature = (products = []) => createHash("sha256")
  .update(JSON.stringify(Array.isArray(products) ? products : []))
  .digest("hex");

export const isValidProductImageUrl = (value) => {
  const url = String(value || "").trim();
  if (!url || PLACEHOLDER_IMAGE_PATTERN.test(url) || /^(?:data|blob):/i.test(url)) return false;
  return /^(?:https?:\/\/|\/\.netlify\/functions\/admin-asset\?key=|\/?products\/)[^\s]+$/i.test(url);
};

export const normaliseProductGallery = (product = {}) => {
  const items = Array.isArray(product.galleryImages) ? product.galleryImages : [];
  return items.map((item, index) => typeof item === "string"
    ? { id: `${product.id}-gallery-${index + 1}`, url: item, alt: "" }
    : {
      id: String(item?.id || `${product.id}-gallery-${index + 1}`).trim(),
      url: String(item?.url || "").trim(),
      alt: String(item?.alt || "").trim(),
    });
};

const isGeneratedPlaceholderProduct = (product = {}) => (
  /^product_[a-z0-9_]+$/i.test(String(product.id || ""))
  && /^(?:new|unnamed) product$/i.test(String(product.name || "").trim())
  && String(product.category || "").trim().toLowerCase() === "needs review"
  && Number(product.price) === 1
  && PLACEHOLDER_IMAGE_PATTERN.test(String(product.image || ""))
);

const normalisedProductName = (value) => productIdentityKey(value).replace(/\s+/g, " ");
const productBrandKey = (product = {}) => productIdentityKey(product.brandId || product.brand);
const productNameKey = (product = {}) => `${productBrandKey(product)}::${normalisedProductName(product.name)}`;

const synchroniseBrands = (seedBrands = [], storedBrands = []) => {
  const managed = Array.isArray(storedBrands) ? storedBrands : [];
  const used = new Set();
  const synced = (Array.isArray(seedBrands) ? seedBrands : []).map((seedBrand) => {
    const match = managed.find((brand) => !used.has(brand) && (
      productIdentityKey(brand?.id) === productIdentityKey(seedBrand?.id)
      || productIdentityKey(brand?.name) === productIdentityKey(seedBrand?.name)
    ));
    if (match) used.add(match);
    return { ...seedBrand, ...(match || {}), id: seedBrand.id || match?.id };
  });
  managed.filter((brand) => !used.has(brand)).forEach((brand) => synced.push(brand));
  return synced;
};

export const synchroniseProductCatalogue = (seedProducts = [], storedProducts = []) => {
  const seed = Array.isArray(seedProducts) ? seedProducts.filter(Boolean) : [];
  const managed = Array.isArray(storedProducts) ? storedProducts.filter(Boolean) : [];
  const used = new Set();
  let added = 0;
  let updated = 0;
  let deduplicated = 0;

  const products = seed.map((seedProduct) => {
    const seedSku = productIdentityKey(seedProduct?.sku);
    const seedName = normalisedProductName(seedProduct?.name);
    const seedBrand = productBrandKey(seedProduct);
    const bySku = seedSku && managed.find((product) => !used.has(product) && productIdentityKey(product?.sku) === seedSku);
    const byName = bySku || (seedName && managed.find((product) => !used.has(product)
      && normalisedProductName(product?.name) === seedName
      && (!seedBrand || !productBrandKey(product) || productBrandKey(product) === seedBrand)));
    const byId = byName || managed.find((product) => !used.has(product)
      && productIdentityKey(product?.id) === productIdentityKey(seedProduct?.id));
    const storedProduct = bySku || byName || byId;
    if (storedProduct) {
      used.add(storedProduct);
      updated += 1;
    } else added += 1;
    return {
      ...seedProduct,
      ...(storedProduct || {}),
      // Seed IDs remain canonical so the static and managed catalogues cannot
      // produce two records for one SKU after a name-based reconciliation.
      id: seedProduct.id || storedProduct?.id,
    };
  });

  const ids = new Set(products.map((product) => productIdentityKey(product?.id)).filter(Boolean));
  const skus = new Set(products.map((product) => productIdentityKey(product?.sku)).filter(Boolean));
  const names = new Set(products.map(productNameKey).filter((key) => !key.endsWith("::")));
  managed.filter((product) => !used.has(product)).forEach((product) => {
    const id = productIdentityKey(product?.id);
    const sku = productIdentityKey(product?.sku);
    const name = productNameKey(product);
    if ((id && ids.has(id)) || (sku && skus.has(sku)) || (name && !name.endsWith("::") && names.has(name))) {
      deduplicated += 1;
      return;
    }
    products.push(product);
    if (id) ids.add(id);
    if (sku) skus.add(sku);
    if (name && !name.endsWith("::")) names.add(name);
  });

  return {
    products,
    stats: {
      seedProducts: seed.length,
      managedProductsBefore: managed.length,
      added,
      updated,
      skipped: 0,
      deduplicated,
      managedOnlyPreserved: products.length - seed.length,
      productsAfter: products.length,
    },
  };
};

export const migrateCatalogueContent = (storedContent = {}, seedContent = {}) => {
  const seedSignature = catalogueSeedSignature(seedContent?.products);
  if (Number(storedContent?.catalogueSchemaVersion) >= CATALOGUE_SCHEMA_VERSION
    && storedContent?.catalogueSeedSignature === seedSignature) {
    return { content: storedContent, changed: false, removedPlaceholderIds: [] };
  }

  const brands = synchroniseBrands(seedContent?.brands, storedContent?.brands);
  const brandNamesById = new Map(brands.map((brand) => [productIdentityKey(brand?.id), brand?.name]));
  const removedPlaceholderIds = [];
  const cleanedStoredProducts = (Array.isArray(storedContent?.products) ? storedContent.products : []).flatMap((product) => {
    if (isGeneratedPlaceholderProduct(product)) {
      removedPlaceholderIds.push(String(product.id));
      return [];
    }
    const canonicalBrand = brandNamesById.get(productIdentityKey(product?.brandId));
    return [{ ...product, ...(canonicalBrand ? { brand: canonicalBrand } : {}) }];
  });

  const synchronised = synchroniseProductCatalogue(seedContent?.products, cleanedStoredProducts);

  return {
    changed: true,
    removedPlaceholderIds,
    content: {
      ...storedContent,
      brands,
      products: synchronised.products,
      catalogueSchemaVersion: CATALOGUE_SCHEMA_VERSION,
      catalogueSeedSignature: seedSignature,
      catalogueSync: {
        version: CATALOGUE_SCHEMA_VERSION,
        synchronizedAt: new Date().toISOString(),
        ...synchronised.stats,
      },
    },
  };
};

export const mergeProductCatalogue = (seedProducts = [], managedProducts) => {
  if (!Array.isArray(managedProducts)) return Array.isArray(seedProducts) ? seedProducts : [];
  return synchroniseProductCatalogue(seedProducts, managedProducts).products;
};

export const validateProductCatalogue = (content, { minimumProducts = 65 } = {}) => {
  const products = Array.isArray(content?.products) ? content.products : [];
  const brands = Array.isArray(content?.brands) ? content.brands : [];
  if (products.length < minimumProducts) return `The product catalogue must contain all ${minimumProducts} products before saving.`;
  if (!brands.length) return "At least one brand is required.";

  const brandNames = brands.map((brand) => productIdentityKey(brand?.name));
  const brandIds = brands.map((brand) => productIdentityKey(brand?.id));
  if (brandNames.some((name) => !name) || new Set(brandNames).size !== brands.length || new Set(brandIds).size !== brands.length) {
    return "Brand names and IDs must be present and unique.";
  }
  if (brands.some((brand) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(brand?.id || "")))) {
    return "Every brand requires a valid lowercase ID.";
  }

  const ids = products.map((product) => productIdentityKey(product?.id));
  const slugs = products.map((product) => productSlugKey(product?.slug || product?.id));
  const skus = products.map((product) => productIdentityKey(product?.sku));
  const duplicateId = ids.find((id, index) => id && ids.indexOf(id) !== index);
  if (duplicateId) return `Duplicate product ID detected: ${duplicateId}. Product IDs must be unique.`;
  const duplicateSlugIndex = slugs.findIndex((slug, index) => slug && slugs.indexOf(slug) !== index);
  if (duplicateSlugIndex >= 0) return `Duplicate product slug detected: ${products[duplicateSlugIndex]?.id}. Choose a unique product ID.`;
  const duplicateSkuIndex = skus.findIndex((sku, index) => sku && skus.indexOf(sku) !== index);
  if (duplicateSkuIndex >= 0) return `Duplicate product SKU detected: ${products[duplicateSkuIndex]?.sku}. SKUs must be unique.`;

  const kalahariCatalogue = products.filter((product) => product?.catalogueSource === "Kalahari Retail Price List 2025");
  if (kalahariCatalogue.length) {
    const expectedCounts = new Set(kalahariCatalogue.map((product) => Number(product.catalogueTotal)));
    if (expectedCounts.size !== 1 || !expectedCounts.has(kalahariCatalogue.length)) {
      return `The Kalahari catalogue must retain all ${[...expectedCounts][0] || "imported"} products.`;
    }
  }

  const brandsById = new Map(brands.map((brand) => [productIdentityKey(brand.id), brand]));
  for (const product of products) {
    const id = String(product?.id || "").trim();
    const brand = brandsById.get(productIdentityKey(product?.brandId));
    const price = Number(product?.price);
    if (!id || !PRODUCT_ID_PATTERN.test(id)) return `Every product requires a stable lowercase ID. Please review: ${product?.name || "Unnamed product"}.`;
    if (!String(product?.name || "").trim()) return `Product name is required for ${id}.`;
    if (!brand) return `Select a valid brand for ${product?.name || id}. Saving was blocked.`;
    if (String(product?.brand || "").trim() !== String(brand.name || "").trim()) {
      return `Brand data does not match the selected brand for ${product?.name || id}. Re-select the intended brand.`;
    }
    if (!isValidProductImageUrl(product?.image)) return `Upload a valid product image for ${product?.name || id}. Placeholder or blank images cannot be saved.`;
    if (!Number.isFinite(price) || price <= 0) return `Enter a valid price for ${product?.name || id}.`;
    if (product?.catalogueSource === "Kalahari Retail Price List 2025") {
      if (!String(product.sku || "").trim() || !String(product.category || "").trim() || !String(product.size || "").trim()) {
        return `Kalahari catalogue fields are incomplete for ${product.name}.`;
      }
      if (!String(product.slug || "").trim() || !String(product.searchKeywords || "").trim()) {
        return `Kalahari SEO slug and search keywords are required for ${product.name}.`;
      }
    }

    const gallery = normaliseProductGallery(product);
    const galleryIds = gallery.map((item) => productIdentityKey(item.id));
    if (galleryIds.some((galleryId) => !galleryId) || new Set(galleryIds).size !== gallery.length) {
      return `Gallery image IDs must be present and unique for ${product?.name || id}.`;
    }
    const invalidGallery = gallery.find((item) => !isValidProductImageUrl(item.url));
    if (invalidGallery) return `Remove or replace an invalid gallery image for ${product?.name || id}.`;
  }
  return "";
};

export const verifyPersistedProducts = (expectedContent, actualContent) => {
  const expected = Array.isArray(expectedContent?.products) ? expectedContent.products : [];
  const actual = Array.isArray(actualContent?.products) ? actualContent.products : [];
  const actualById = new Map(actual.map((product) => [productIdentityKey(product?.id), product]));
  for (const product of expected) {
    const persisted = actualById.get(productIdentityKey(product?.id));
    if (!persisted) return `Saved product could not be reloaded: ${product?.name || product?.id}.`;
    if (persisted.brandId !== product.brandId || persisted.brand !== product.brand) return `Saved brand could not be verified for ${product?.name || product?.id}.`;
    if (persisted.image !== product.image) return `Saved main image could not be verified for ${product?.name || product?.id}.`;
    const expectedGallery = normaliseProductGallery(product);
    const actualGallery = normaliseProductGallery(persisted);
    if (JSON.stringify(actualGallery) !== JSON.stringify(expectedGallery)) return `Saved gallery images could not be verified for ${product?.name || product?.id}.`;
  }
  return "";
};
