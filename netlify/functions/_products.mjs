const PLACEHOLDER_IMAGE_PATTERN = /(?:^|\/)(?:lullubelle-logo|placeholder|default-product|sample-product)(?:[._/?-]|$)/i;
const PRODUCT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
export const CATALOGUE_SCHEMA_VERSION = 2;

export const productIdentityKey = (value) => String(value || "").trim().toLowerCase();

export const productSlugKey = (value) => productIdentityKey(value)
  .replace(/&/g, "and")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

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

export const migrateCatalogueContent = (storedContent = {}, seedContent = {}) => {
  if (Number(storedContent?.catalogueSchemaVersion) >= CATALOGUE_SCHEMA_VERSION) {
    return { content: storedContent, changed: false, removedPlaceholderIds: [] };
  }

  const seedBrandsById = new Map((Array.isArray(seedContent?.brands) ? seedContent.brands : [])
    .map((brand) => [productIdentityKey(brand?.id), brand]));
  const storedBrands = Array.isArray(storedContent?.brands) && storedContent.brands.length
    ? storedContent.brands
    : (Array.isArray(seedContent?.brands) ? seedContent.brands : []);
  const brands = storedBrands.map((brand) => {
    const canonical = seedBrandsById.get(productIdentityKey(brand?.id));
    return canonical?.name ? { ...brand, name: canonical.name } : brand;
  });
  const brandNamesById = new Map(brands.map((brand) => [productIdentityKey(brand?.id), brand?.name]));
  const removedPlaceholderIds = [];
  const products = (Array.isArray(storedContent?.products) ? storedContent.products : []).flatMap((product) => {
    if (isGeneratedPlaceholderProduct(product)) {
      removedPlaceholderIds.push(String(product.id));
      return [];
    }
    const canonicalBrand = brandNamesById.get(productIdentityKey(product?.brandId));
    return [{ ...product, ...(canonicalBrand ? { brand: canonicalBrand } : {}) }];
  });

  return {
    changed: true,
    removedPlaceholderIds,
    content: {
      ...storedContent,
      brands,
      products,
      catalogueSchemaVersion: CATALOGUE_SCHEMA_VERSION,
    },
  };
};

export const mergeProductCatalogue = (seedProducts = [], managedProducts) => {
  if (!Array.isArray(managedProducts)) return Array.isArray(seedProducts) ? seedProducts : [];
  const merged = new Map();
  (Array.isArray(seedProducts) ? seedProducts : []).forEach((product) => {
    const key = productIdentityKey(product?.id);
    if (key) merged.set(key, product);
  });
  managedProducts.forEach((product) => {
    const key = productIdentityKey(product?.id);
    if (key) merged.set(key, product);
  });
  return [...merged.values()];
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
  const slugs = products.map((product) => productSlugKey(product?.id));
  const duplicateId = ids.find((id, index) => id && ids.indexOf(id) !== index);
  if (duplicateId) return `Duplicate product ID detected: ${duplicateId}. Product IDs must be unique.`;
  const duplicateSlugIndex = slugs.findIndex((slug, index) => slug && slugs.indexOf(slug) !== index);
  if (duplicateSlugIndex >= 0) return `Duplicate product slug detected: ${products[duplicateSlugIndex]?.id}. Choose a unique product ID.`;

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
