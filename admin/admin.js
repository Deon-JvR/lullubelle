const API = "/.netlify/functions/admin-api";

const state = {
  content: { brands: [], products: [], treatments: [], gallery: [], vouchers: [], deliverySettings: { freeDeliveryThreshold: 1000, standardPudoFee: 80, collectionEnabled: true } },
  bookings: [],
  orders: [],
  discounts: [],
  discountSearch: "",
  discountFilter: "all",
  dirty: false,
  saving: false,
  pendingUploads: new Map(),
  productUi: {
    mode: "list",
    editingId: "",
    selectedIds: new Set(),
    search: "",
    brand: "all",
    stock: "all",
    visibility: "all",
    featured: "all",
    bestSeller: "all",
    sort: "name-az",
    filtersOpen: false,
  },
};

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

const uid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
const money = (value) => Number(value || 0);
const STOCK_STATUSES = ["In stock", "Out of stock", "Coming soon"];
const PRODUCT_SORTS = [
  ["name-az", "Product name A-Z"],
  ["brand", "Brand"],
  ["price-asc", "Price low-high"],
  ["price-desc", "Price high-low"],
  ["newest", "Newest"],
  ["oldest", "Oldest"],
];
const escapeHtml = (value = "") => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");
const cssEscape = (value = "") => window.CSS?.escape
  ? CSS.escape(String(value))
  : String(value).replace(/["\\]/g, "\\$&");
const slugify = (value = "brand") => String(value).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brand";
const sortedBrands = () => [...(state.content.brands || [])].sort((a, b) => Number(a.order) - Number(b.order) || a.name.localeCompare(b.name));
const activeBrands = () => sortedBrands().filter((brand) => brand.active !== false);
const productEditorBrands = (product) => {
  const active = activeBrands();
  const current = brandForProduct(product);
  return current && !active.some((brand) => brand.id === current.id) ? [...active, current] : active;
};
const brandForProduct = (product) => state.content.brands.find((brand) => brand.id === product.brandId)
  || state.content.brands.find((brand) => brand.name.toLowerCase() === String(product.brand || "").toLowerCase());

const setStatus = (message, type = "") => {
  const node = $("[data-admin-status]");
  if (!node) return;
  node.className = `status ${type ? `is-${type}` : ""}`;
  node.textContent = message;
};

const setLoginStatus = (message = "", type = "") => {
  const node = $("[data-login-status]");
  if (!node) return;
  node.className = `status ${type ? `is-${type}` : ""}`;
  node.textContent = message;
};

const setDirty = (dirty = true) => {
  state.dirty = dirty;
  $("[data-save-state]").textContent = dirty ? "Unsaved changes" : "All changes saved";
};

const request = async (action, options = {}) => {
  let response;
  try {
    response = await fetch(`${API}?action=${encodeURIComponent(action)}`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
  } catch (cause) {
    console.error(`[Admin API] ${action} network failure`, cause);
    throw new Error("Could not reach the server. Check your connection and try again.");
  }

  const responseText = await response.text().catch(() => "");
  let data = {};
  try { data = responseText ? JSON.parse(responseText) : {}; } catch { data = {}; }
  if (!response.ok) {
    const statusMessages = {
      400: "Validation failed. Check the required product fields.",
      401: "Session expired. Sign in again and retry.",
      403: "You do not have permission to perform this action.",
      404: "The Admin API could not be found.",
      409: "The product or brand conflicts with an existing record.",
      413: "Image upload failed because the file is too large.",
      500: action === "upload" ? "Image storage is unavailable. Please try again." : "Product could not be saved because storage is unavailable.",
      502: "Storage service configuration failed. Please contact the site administrator.",
      503: action === "upload" ? "Image storage is unavailable. Please try again." : "Product storage is temporarily unavailable.",
    };
    const message = data.error || statusMessages[response.status] || `Admin request failed (HTTP ${response.status}).`;
    if (!(action === "me" && response.status === 401)) {
      console.error(`[Admin API] ${action} failed`, { status: response.status, message, response: responseText.slice(0, 1000) });
    }
    const error = new Error(message);
    error.status = response.status;
    error.code = data.code || "ADMIN_REQUEST_FAILED";
    throw error;
  }
  return data;
};

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

const decodeImage = async (file) => {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (bitmap) return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("This image format could not be decoded. Please use JPEG, PNG or WebP."));
      image.src = url;
    });
    return { image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
};

const convertImageToWebP = async (file) => {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") return null;
  const decoded = await decodeImage(file);
  const maxSize = 1400;
  const scale = Math.min(1, maxSize / Math.max(decoded.width, decoded.height));
  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(decoded.image, 0, 0, width, height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
  decoded.close();
  if (!blob) throw new Error("Image conversion failed. Please use JPEG, PNG or WebP.");
  return blob;
};

const uploadImage = async (file, binding) => {
  if (!file?.type?.startsWith("image/")) throw new Error("Image upload failed: select a valid image file.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Image upload failed: the source file must be smaller than 20 MB.");
  const webp = await convertImageToWebP(file);
  const uploadFile = webp || file;
  if (uploadFile.size > 3.5 * 1024 * 1024) throw new Error("Image upload failed: the optimised file is still too large. Please use a smaller image.");
  const filename = webp ? `${file.name.replace(/\.[^.]+$/, "")}.webp` : file.name;
  const mimeType = webp ? "image/webp" : file.type;
  const dataUrl = await blobToDataUrl(uploadFile);
  const result = await request("upload", {
    method: "POST",
    body: JSON.stringify({ filename, mimeType, base64: dataUrl, ...binding }),
  });
  if (!result.url || result.binding?.ownerType !== binding.ownerType || result.binding?.ownerId !== binding.ownerId || result.binding?.slot !== binding.slot || (binding.slot === "gallery" && result.binding?.imageId !== binding.imageId)) {
    throw new Error("The uploaded image was not associated with the requested product. Nothing was changed.");
  }
  const verification = await fetch(result.url, { credentials: "same-origin", cache: "no-store", headers: { Accept: "image/*" } });
  if (!verification.ok || !String(verification.headers.get("Content-Type") || "").startsWith("image/")) {
    throw new Error("The uploaded image could not be reloaded from storage. Please try again.");
  }
  return result.url;
};

const field = (label, value, key, type = "text", extra = "") => `
  <label ${extra.includes("wide") ? 'class="wide"' : ""}>${escapeHtml(label)}
    ${type === "textarea"
      ? `<textarea data-key="${escapeHtml(key)}">${escapeHtml(value || "")}</textarea>`
      : `<input type="${escapeHtml(type)}" data-key="${escapeHtml(key)}" value="${escapeHtml(value ?? "")}">`}
  </label>`;

const select = (label, value, key, options) => `
  <label>${escapeHtml(label)}
    <select data-key="${escapeHtml(key)}">
      ${options.map((option) => { const pair = Array.isArray(option) ? option : [option, option]; return `<option value="${escapeHtml(pair[0])}" ${pair[0] === value ? "selected" : ""}>${escapeHtml(pair[1])}</option>`; }).join("")}
    </select>
  </label>`;

const checkbox = (label, checked, key) => `
  <label class="check-row"><input type="checkbox" data-key="${escapeHtml(key)}" ${checked ? "checked" : ""}> ${escapeHtml(label)}</label>`;

const productVisibilityLabel = (product) => product.hidden ? "Hidden" : "Visible";
const productBadge = (label, active, tone = "") => `<span class="status-pill ${active ? "is-active" : ""} ${tone}">${escapeHtml(label)}</span>`;
const adminImageSrc = (image) => {
  const value = String(image || "").trim();
  if (!value) return "/lullubelle-logo.jpg";
  if (/^(https?:|data:|blob:|\/)/i.test(value)) return value;
  return `/${value.replace(/^\.?\//, "")}`;
};
const invalidProductImage = (image) => {
  const value = String(image || "").trim();
  return !value
    || /(?:^|\/)(?:lullubelle-logo|placeholder|default-product|sample-product)(?:[._/?-]|$)/i.test(value)
    || /^(?:data|blob):/i.test(value)
    || !/^(?:https?:\/\/|\/\.netlify\/functions\/admin-asset\?key=|\/?products\/)[^\s]+$/i.test(value);
};
const productGallery = (product = {}) => (Array.isArray(product.galleryImages) ? product.galleryImages : []).map((item, index) => typeof item === "string"
  ? { id: `${product.id}-gallery-${index + 1}`, url: item, alt: "" }
  : { id: String(item?.id || `${product.id}-gallery-${index + 1}`), url: String(item?.url || ""), alt: String(item?.alt || "") });
const productBadges = (product) => {
  const badges = [];
  if (product.featured) badges.push(productBadge("Featured", true, "featured"));
  if (product.bestSeller) badges.push(productBadge("Best Seller", true, "best-seller"));
  return badges.join(" ") || productBadge("None", false);
};

const getProductById = (id) => state.content.products.find((product) => product.id === id);

const setSavingState = (saving) => {
  state.saving = saving;
  $$('[data-save]').forEach((button) => {
    button.disabled = saving;
    button.setAttribute("aria-busy", String(saving));
  });
  const saveState = $("[data-save-state]");
  if (saveState && saving) saveState.textContent = "Saving and verifying…";
};

const getFilteredProducts = () => {
  const ui = state.productUi;
  const search = ui.search.trim().toLowerCase();
  const exactSkuSearch = search && state.content.products.some((product) => String(product.sku || "").trim().toLowerCase() === search);
  return [...state.content.products]
    .filter((product) => {
      const searchable = [product.name, product.sku, product.category, product.searchKeywords].join(" ").toLowerCase();
      const sku = String(product.sku || "").trim().toLowerCase();
      const brandId = brandForProduct(product)?.id || "";
      const stock = String(product.stockStatus || "In stock");
      const visibleMatch = ui.visibility === "all"
        || (ui.visibility === "visible" && !product.hidden)
        || (ui.visibility === "hidden" && product.hidden);
      const featuredMatch = ui.featured === "all"
        || (ui.featured === "yes" && product.featured === true)
        || (ui.featured === "no" && product.featured !== true);
      const bestSellerMatch = ui.bestSeller === "all"
        || (ui.bestSeller === "yes" && product.bestSeller === true)
        || (ui.bestSeller === "no" && product.bestSeller !== true);
      return (!search || (exactSkuSearch ? sku === search : searchable.includes(search)))
        && (ui.brand === "all" || brandId === ui.brand)
        && (ui.stock === "all" || stock === ui.stock)
        && visibleMatch
        && featuredMatch
        && bestSellerMatch;
    })
    .sort((a, b) => {
      if (ui.sort === "brand") return `${a.brand || ""} ${a.name || ""}`.localeCompare(`${b.brand || ""} ${b.name || ""}`);
      if (ui.sort === "price-asc") return money(a.price) - money(b.price);
      if (ui.sort === "price-desc") return money(b.price) - money(a.price);
      if (ui.sort === "newest") return state.content.products.indexOf(a) - state.content.products.indexOf(b);
      if (ui.sort === "oldest") return state.content.products.indexOf(b) - state.content.products.indexOf(a);
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
};

const productFilterControls = (products) => {
  const brands = sortedBrands();
  const activeAdvancedFilters = ["stock", "visibility", "featured", "bestSeller"]
    .filter((key) => state.productUi[key] !== "all").length;
  const filterSelect = (label, key, value, options) => `
    <label>${escapeHtml(label)}
      <select data-product-filter="${escapeHtml(key)}">
        ${options.map(([optionValue, optionLabel]) => `<option value="${escapeHtml(optionValue)}" ${optionValue === value ? "selected" : ""}>${escapeHtml(optionLabel)}</option>`).join("")}
      </select>
    </label>`;

  return `
    <nav class="brand-tabs" aria-label="Filter products by brand">
      <button type="button" class="${state.productUi.brand === "all" ? "is-active" : ""}" data-product-brand-tab="all">All Brands (${products.length})</button>
      ${brands.map((brand) => `<button type="button" class="${state.productUi.brand === brand.id ? "is-active" : ""}" data-product-brand-tab="${escapeHtml(brand.id)}">${escapeHtml(brand.name)} (${products.filter((product) => brandForProduct(product)?.id === brand.id).length})</button>`).join("")}
    </nav>
    <div class="product-tools">
      <div class="product-tools-main">
        <label class="product-search">Search products
          <input type="search" data-product-search value="${escapeHtml(state.productUi.search)}" placeholder="Search by name, SKU, category or keyword">
        </label>
        ${filterSelect("Sort", "sort", state.productUi.sort, PRODUCT_SORTS)}
        <button class="button secondary compact-button" type="button" data-product-filters-toggle aria-expanded="${state.productUi.filtersOpen ? "true" : "false"}">More Filters${activeAdvancedFilters ? ` (${activeAdvancedFilters})` : ""}</button>
      </div>
      <div class="product-tools-drawer" ${state.productUi.filtersOpen ? "" : "hidden"}>
        ${filterSelect("Stock", "stock", state.productUi.stock, [["all", "All stock"], ...STOCK_STATUSES.map((status) => [status, status])])}
        ${filterSelect("Visibility", "visibility", state.productUi.visibility, [["all", "All"], ["visible", "Visible"], ["hidden", "Hidden"]])}
        ${filterSelect("Featured", "featured", state.productUi.featured, [["all", "All"], ["yes", "Featured"], ["no", "Not featured"]])}
        ${filterSelect("Best seller", "bestSeller", state.productUi.bestSeller, [["all", "All"], ["yes", "Best sellers"], ["no", "Not best sellers"]])}
      </div>
    </div>`;
};

const renderProductRows = (products) => {
  if (!state.content.products.length) return `<p>No products were found in the shared website catalogue.</p>`;
  if (!products.length) return `<p>No products match the current search or filters.</p>`;
  const allShownSelected = products.every((product) => state.productUi.selectedIds.has(product.id));

  return `
    <div class="bulk-actions">
      <label class="check-row"><input type="checkbox" data-product-select-all ${allShownSelected ? "checked" : ""}> Select all shown</label>
      <span>${state.productUi.selectedIds.size} selected</span>
      <div class="bulk-action-buttons" ${state.productUi.selectedIds.size ? "" : "hidden"}>
        <button class="button secondary" type="button" data-product-bulk="hide">Hide</button>
        <button class="button secondary" type="button" data-product-bulk="show">Show</button>
        <button class="button secondary" type="button" data-product-bulk="feature">Featured</button>
        <button class="button secondary" type="button" data-product-bulk="unfeature">Unfeatured</button>
        <button class="button secondary" type="button" data-product-bulk="bestseller">Best Seller</button>
        <button class="button secondary" type="button" data-product-bulk="unbestseller">Not Best Seller</button>
      </div>
    </div>
    <div class="product-table-wrap">
      <table class="product-table">
        <colgroup>
          <col class="col-select">
          <col class="col-image">
          <col class="col-product">
          <col class="col-brand">
          <col class="col-price">
          <col class="col-stock">
          <col class="col-badges">
          <col class="col-visibility">
          <col class="col-actions">
        </colgroup>
        <thead>
          <tr>
            <th aria-label="Select"></th>
            <th>Image</th>
            <th>Product</th>
            <th>Brand</th>
            <th>Price</th>
            <th>Stock</th>
            <th>Badges</th>
            <th>Visibility</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${products.map((product) => `
            <tr class="${product.hidden ? "is-hidden" : ""}" data-product-row="${escapeHtml(product.id)}">
              <td data-label="Select"><input type="checkbox" data-product-select="${escapeHtml(product.id)}" ${state.productUi.selectedIds.has(product.id) ? "checked" : ""}></td>
              <td data-label="Image"><button class="image-button" type="button" data-product-edit="${escapeHtml(product.id)}"><img class="product-list-thumb" src="${escapeHtml(adminImageSrc(product.image))}" alt="${escapeHtml(product.imageAlt || product.name || "Product image")}" loading="lazy"></button></td>
              <td data-label="Product">
                <div class="product-row-title">
                  <div>
                    <strong data-product-name="${escapeHtml(product.id)}">${escapeHtml(product.name || "Unnamed product")}</strong>
                    <small data-product-slug="${escapeHtml(product.id)}">${escapeHtml(product.id || "")}</small>
                    <small>${escapeHtml([product.sku && `SKU ${product.sku}`, product.category, product.size].filter(Boolean).join(" · "))}</small>
                  </div>
                </div>
              </td>
              <td data-label="Brand" data-product-brand="${escapeHtml(product.id)}">${escapeHtml(product.brand || "Needs review")}</td>
              <td data-label="Price"><input class="quick-price" type="number" min="1" step="1" value="${money(product.price)}" name="price-${escapeHtml(product.id)}" data-product-id="${escapeHtml(product.id)}" data-product-quick="${escapeHtml(product.id)}" data-product-key="price" aria-label="Edit price for ${escapeHtml(product.name || "product")}"></td>
              <td data-label="Stock">
                <select class="quick-select" name="stock-${escapeHtml(product.id)}" data-product-id="${escapeHtml(product.id)}" data-product-quick="${escapeHtml(product.id)}" data-product-key="stockStatus" aria-label="Edit stock for ${escapeHtml(product.name || "product")}">
                  ${STOCK_STATUSES.map((status) => `<option value="${escapeHtml(status)}" ${status === (product.stockStatus || "In stock") ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}
                </select>
              </td>
              <td data-label="Badges">
                <div class="badge-stack">
                  <span data-product-badges="${escapeHtml(product.id)}">${productBadges(product)}</span>
                  <button class="quick-chip featured ${product.featured ? "is-on" : ""}" type="button" name="featured-${escapeHtml(product.id)}" data-product-id="${escapeHtml(product.id)}" data-product-toggle="${escapeHtml(product.id)}" data-product-key="featured">F</button>
                  <button class="quick-chip best-seller ${product.bestSeller ? "is-on" : ""}" type="button" name="bestSeller-${escapeHtml(product.id)}" data-product-id="${escapeHtml(product.id)}" data-product-toggle="${escapeHtml(product.id)}" data-product-key="bestSeller">B</button>
                </div>
              </td>
              <td data-label="Visibility">
                <select class="quick-select" name="visibility-${escapeHtml(product.id)}" data-product-id="${escapeHtml(product.id)}" data-product-quick="${escapeHtml(product.id)}" data-product-key="hidden" aria-label="Edit visibility for ${escapeHtml(product.name || "product")}">
                  <option value="false" ${product.hidden ? "" : "selected"}>Visible</option>
                  <option value="true" ${product.hidden ? "selected" : ""}>Hidden</option>
                </select>
              </td>
              <td data-label="Actions">
                <div class="row-actions">
                  <button class="button secondary" type="button" data-product-edit="${escapeHtml(product.id)}">Edit</button>
                  <button class="button secondary" type="button" data-product-hide="${escapeHtml(product.id)}" data-product-hide-label="${escapeHtml(product.id)}">${product.hidden ? "Show" : "Hide"}</button>
                  <button class="button danger" type="button" data-product-delete="${escapeHtml(product.id)}" ${product.catalogueSource === "Kalahari Retail Price List 2025" ? 'disabled title="Required catalogue products can be deactivated but not deleted"' : ""}>Delete</button>
                </div>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
};

const renderProductGalleryEditor = (product) => {
  const images = productGallery(product);
  return `
    <div class="product-gallery-editor" data-product-gallery>
      <p class="hint">Optional gallery images appear after the main image and keep this order.</p>
      ${images.length ? `<div class="product-gallery-editor-list">${images.map((image, index) => `
        <article class="product-gallery-editor-item" data-gallery-image-id="${escapeHtml(image.id)}">
          <img src="${escapeHtml(adminImageSrc(image.url))}" alt="${escapeHtml(image.alt || `${product.name || "Product"} gallery image ${index + 1}`)}">
          <div>
            ${field(`Gallery image ${index + 1} URL`, image.url, "galleryUrl", "text", "wide").replace('data-key="galleryUrl"', `data-gallery-key="url" data-gallery-id="${escapeHtml(image.id)}"`)}
            ${field("Alt text", image.alt, "galleryAlt", "text", "wide").replace('data-key="galleryAlt"', `data-gallery-key="alt" data-gallery-id="${escapeHtml(image.id)}"`)}
            <label>Replace image <input type="file" accept="image/*" data-gallery-upload-id="${escapeHtml(image.id)}"></label>
            <button class="button danger" type="button" data-gallery-remove="${escapeHtml(image.id)}">Remove gallery image</button>
          </div>
        </article>`).join("")}</div>` : "<p>No gallery images added.</p>"}
      <label>Add gallery image <input type="file" accept="image/*" data-gallery-upload-new></label>
    </div>`;
};

const renderProductEditor = (product) => `
  <article class="editor-card product-editor ${product.hidden ? "is-hidden" : ""}" data-id="${escapeHtml(product.id)}" data-collection="products">
    <div class="product-editor-header">
      <button class="button secondary" type="button" data-product-back>Back to Products</button>
      <div>
        <p class="eyebrow">${escapeHtml(product.brand || "Product")}</p>
        <h3>${escapeHtml(product.name || "New product")}</h3>
      </div>
    </div>
    <div class="product-editor-grid">
      <section class="editor-section">
        <h4>General</h4>
        <div class="form-grid">
          ${field("Product name", product.name, "name")}
          <label>Product ID / slug<input type="text" value="${escapeHtml(product.id)}" readonly aria-describedby="product-id-help"><small id="product-id-help">Stable identity used for images and storefront URLs.</small></label>
          <label>Brand
            <select data-key="brandId" required>
              <option value="" ${product.brandId ? "" : "selected"} disabled>Select a brand…</option>
              ${productEditorBrands(product).map((brand) => `<option value="${escapeHtml(brand.id)}" ${brand.id === product.brandId ? "selected" : ""}>${escapeHtml(brand.name)}${brand.active === false ? " (inactive)" : ""}</option>`).join("")}
              <option value="__add_brand__">＋ Add new brand…</option>
            </select>
          </label>
          ${field("Category", product.category || "", "category")}
          ${field("SKU", product.sku || "", "sku")}
          ${field("Size", product.size || "", "size")}
        </div>
      </section>
      <section class="editor-section">
        <h4>Pricing</h4>
        <div class="form-grid">
          ${field("Price", product.price || 0, "price", "number")}
          ${select("Stock status", product.stockStatus || "In stock", "stockStatus", STOCK_STATUSES)}
        </div>
      </section>
      <section class="editor-section">
        <h4>Image</h4>
        <div class="product-image-editor">
          <img class="product-editor-thumb" src="${escapeHtml(adminImageSrc(product.image))}" alt="${escapeHtml(product.imageAlt || product.name || "Product image")}">
          <div class="form-grid">
            ${field("Image URL", product.image || "", "image", "text", "wide")}
            ${field("Image alt text", product.imageAlt || "", "imageAlt", "text", "wide")}
            <label class="wide">Upload/change product image <input type="file" accept="image/*" data-upload="image"></label>
          </div>
        </div>
        <h4>Gallery images</h4>
        ${renderProductGalleryEditor(product)}
      </section>
      <section class="editor-section">
        <h4>Description</h4>
        <div class="form-grid">
          ${field("Short benefit", product.benefit || "", "benefit", "textarea", "wide")}
          ${field("Full description", product.description || "", "description", "textarea", "wide")}
          ${field("Directions for use", product.directions || "", "directions", "textarea", "wide")}
          ${field("Ingredients", product.ingredients || "", "ingredients", "textarea", "wide")}
          ${field("Suitable skin type", product.suitable || "", "suitable", "textarea", "wide")}
          ${field("Skin type / concern tags", Array.isArray(product.tags) ? product.tags.join(", ") : product.tags || "", "tags", "text", "wide")}
          ${field("Related products", Array.isArray(product.relatedProducts) ? product.relatedProducts.join(", ") : product.relatedProducts || "", "relatedProducts", "text", "wide")}
        </div>
      </section>
      <section class="editor-section">
        <h4>SEO</h4>
        <div class="form-grid">
          ${field("SEO title", product.seoTitle || "", "seoTitle", "text", "wide")}
          ${field("SEO slug", product.slug || product.id || "", "slug", "text", "wide")}
          ${field("SEO meta description", product.seoDescription || product.metaDescription || "", "seoDescription", "textarea", "wide")}
          ${field("Search keywords", product.searchKeywords || "", "searchKeywords", "textarea", "wide")}
        </div>
      </section>
      <section class="editor-section">
        <h4>Visibility / Badges</h4>
        <div class="form-grid compact-checks">
          ${checkbox("Featured product", product.featured, "featured")}
          ${checkbox("Best seller", product.bestSeller, "bestSeller")}
          ${checkbox("Hidden from public shop", product.hidden, "hidden")}
        </div>
      </section>
    </div>
    <div class="sticky-editor-actions">
      <button class="button primary" type="button" data-save>Save changes</button>
      <button class="button secondary" type="button" data-product-back>Cancel</button>
    </div>
  </article>`;

const cardShell = (item, collection, title, body, imageKey = "image") => `
  <article class="editor-card ${item.hidden ? "is-hidden" : ""}" data-id="${escapeHtml(item.id)}" data-collection="${escapeHtml(collection)}">
    <div class="panel-heading">
      <div class="inline-grid">
        ${item[imageKey] ? `<img class="thumb" src="${escapeHtml(item[imageKey])}" alt="">` : ""}
        <h3>${escapeHtml(title)}</h3>
      </div>
      <div class="row-actions">
        <button class="button secondary" type="button" data-hide>${item.hidden ? "Show" : "Hide"}</button>
        <button class="button danger" type="button" data-delete>Delete</button>
      </div>
    </div>
    <div class="form-grid">${body}</div>
  </article>`;

const renderProducts = ({ preserveScroll = false } = {}) => {
  const list = $("[data-list='products']");
  const productScrollTop = preserveScroll ? list.querySelector(".product-table-wrap")?.scrollTop || 0 : 0;
  const editingProduct = getProductById(state.productUi.editingId);
  if (state.productUi.mode === "edit" && editingProduct) {
    list.innerHTML = renderProductEditor(editingProduct);
    return;
  }

  state.productUi.mode = "list";
  state.productUi.editingId = "";
  const filteredProducts = getFilteredProducts();
  list.innerHTML = `
    ${productFilterControls(state.content.products)}
    <div class="product-list-summary">
      <strong>${filteredProducts.length}</strong> of ${state.content.products.length} products shown
    </div>
    ${renderProductRows(filteredProducts)}
  `;
  if (preserveScroll) {
    const productTable = list.querySelector(".product-table-wrap");
    if (productTable) productTable.scrollTop = productScrollTop;
  }
};

const updateProductSelectionSummary = () => {
  const selectedCount = state.productUi.selectedIds.size;
  const bulkActions = $(".bulk-actions");
  if (!bulkActions) return;
  const countNode = bulkActions.querySelector("span");
  if (countNode) countNode.textContent = `${selectedCount} selected`;
  const buttons = bulkActions.querySelector(".bulk-action-buttons");
  if (buttons) buttons.hidden = selectedCount === 0;
  const selectAll = bulkActions.querySelector("[data-product-select-all]");
  if (selectAll) {
    const shown = getFilteredProducts();
    selectAll.checked = shown.length > 0 && shown.every((product) => state.productUi.selectedIds.has(product.id));
  }
};

const updateProductRow = (product) => {
  if (!product?.id) return;
  const productId = cssEscape(product.id);
  const row = $(`[data-product-row="${productId}"]`);
  if (!row) return;
  row.classList.toggle("is-hidden", Boolean(product.hidden));
  const name = row.querySelector(`[data-product-name="${productId}"]`);
  if (name) name.textContent = product.name || "Unnamed product";
  const slug = row.querySelector(`[data-product-slug="${productId}"]`);
  if (slug) slug.textContent = product.id || "";
  const brand = row.querySelector(`[data-product-brand="${productId}"]`);
  if (brand) brand.textContent = product.brand || "Needs review";
  const badges = row.querySelector(`[data-product-badges="${productId}"]`);
  if (badges) badges.innerHTML = productBadges(product);
  row.querySelectorAll("[data-product-toggle]").forEach((button) => {
    button.classList.toggle("is-on", Boolean(product[button.dataset.productKey]));
  });
  const visibility = row.querySelector("[data-product-key='hidden']");
  if (visibility && document.activeElement !== visibility) visibility.value = product.hidden ? "true" : "false";
  const stock = row.querySelector("[data-product-key='stockStatus']");
  if (stock && document.activeElement !== stock) stock.value = product.stockStatus || "In stock";
  const price = row.querySelector("[data-product-key='price']");
  if (price && document.activeElement !== price) price.value = money(product.price);
  const hideLabel = row.querySelector(`[data-product-hide-label="${productId}"]`);
  if (hideLabel) hideLabel.textContent = product.hidden ? "Show" : "Hide";
};

const updateProductQuickControl = (input) => {
  const item = getProductById(input.dataset.productQuick);
  if (!item) return;
  const key = input.dataset.productKey;
  if (key === "price") item.price = Number(input.value) || 0;
  else if (key === "hidden") item.hidden = input.value === "true";
  else item[key] = input.value;
  setDirty();
  updateProductRow(item);
};

const renderTreatments = () => {
  $("[data-list='treatments']").innerHTML = state.content.treatments.map((item) => cardShell(item, "treatments", item.name || "New treatment", `
    ${field("Category", item.category || "", "category")}
    ${field("Option group", item.group || "", "group")}
    ${field("Treatment name", item.name, "name")}
    ${field("Price", item.price || "", "price")}
    ${field("Duration", item.duration || "", "duration")}
    ${checkbox("Featured treatment", item.featured, "featured")}
    ${field("Description", item.description || "", "description", "textarea", "wide")}
  `, "")).join("") || `<p>No treatments were found in the shared website catalogue.</p>`;
};

const renderGallery = () => {
  state.content.gallery.sort((a, b) => (Number(a.order) || Number.MAX_SAFE_INTEGER) - (Number(b.order) || Number.MAX_SAFE_INTEGER) || String(a.title || "").localeCompare(String(b.title || "")));
  $("[data-list='gallery']").innerHTML = state.content.gallery.map((item) => cardShell(item, "gallery", item.title || "New gallery item", `
    ${field("Title", item.title, "title")}
    ${field("Treatment category", item.category || "microneedling", "category")}
    ${field("Filter keywords", item.categories || "", "categories")}
    ${field("Display order", item.order ?? "", "order", "number")}
    ${field("Number of treatments", item.treatments || "", "treatments")}
    ${checkbox("Featured result", item.featured, "featured")}
    ${field("Description", item.description || "", "description", "textarea", "wide")}
    ${field("Image URL", item.image || "", "image", "text", "wide")}
    <label class="wide">Upload before/after image <input type="file" accept="image/*" data-upload="image"></label>
  `)).join("") || `<p>No Before &amp; After items were found in the shared website catalogue.</p>`;
};

const renderVouchers = () => {
  $("[data-list='vouchers']").innerHTML = state.content.vouchers.map((item) => cardShell(item, "vouchers", item.name || `R${item.amount || 0} Voucher`, `
    ${field("Voucher name", item.name || "", "name")}
    ${field("Amount", item.amount || 0, "amount", "number")}
    ${field("Description", item.description || "", "description", "textarea", "wide")}
  `, "")).join("") || `<p>No gift vouchers were found in the shared website catalogue.</p>`;
};

const renderBookings = () => {
  $("[data-list='bookings']").innerHTML = state.bookings.map((item) => `
    <article class="editor-card" data-id="${escapeHtml(item.id)}" data-record="bookings">
      <div class="panel-heading"><h3>${escapeHtml(item.name || "Unnamed client")}</h3><span>${escapeHtml(item.createdAt ? new Date(item.createdAt).toLocaleString() : "")}</span></div>
      <div class="form-grid">
        ${field("Client name", item.name || "", "name")}
        ${field("Phone", item.phone || "", "phone")}
        ${field("Email", item.email || "", "email")}
        ${field("Treatment selected", item.treatment || "", "treatment")}
        ${field("Preferred date", item.preferredDate || "", "preferredDate")}
        ${field("Preferred time", item.preferredTime || "", "preferredTime")}
        ${select("Status", item.status || "New", "status", ["New", "Contacted", "Confirmed", "Completed"])}
        ${field("Notes", item.notes || "", "notes", "textarea", "wide")}
      </div>
    </article>`).join("") || `<p>No appointment requests have been captured yet.</p>`;
};

const renderOrders = () => {
  $("[data-list='orders']").innerHTML = state.orders.map((item) => `
    <article class="editor-card" data-id="${escapeHtml(item.id)}" data-record="orders">
      <div class="panel-heading"><h3>${escapeHtml(item.orderNumber || item.id)}</h3><strong>R${money(item.total)}</strong></div>
      <div class="form-grid">
        ${field("Order number", item.orderNumber || "", "orderNumber")}
        ${field("Customer details", JSON.stringify(item.customer || {}, null, 2), "customerText", "textarea")}
        ${field("Products", JSON.stringify(item.products || [], null, 2), "productsText", "textarea")}
        ${field("Delivery / collection", item.delivery?.option === "collection" ? "Collect from Lullubelle – Centurion" : item.delivery?.label || "", "deliveryLabel")}
        ${field("Promo code", item.promoCode || "", "promoCode")}
        ${field("Original subtotal", item.originalSubtotal ?? item.subtotal ?? 0, "originalSubtotal", "number")}
        ${field("Discount amount", item.discountAmount || 0, "discountAmount", "number")}
        ${field("Delivery fee", item.deliveryFee || 0, "deliveryFee", "number")}
        ${field("Free delivery applied", item.freeDeliveryApplied ? "Yes" : "No", "freeDeliveryApplied")}
        ${field("Total", item.total || 0, "total", "number")}
        ${select("Payment status", item.paymentStatus || "Pending", "paymentStatus", ["Pending", "Paid", "Failed", "Refunded"])}
        ${select("Order status", item.orderStatus || "New", "orderStatus", ["New", "Processing", "Ready", "Completed", "Cancelled"])}
      </div>
    </article>`).join("") || `<p>No orders have been captured yet.</p>`;
};

const renderDiscounts = () => {
  const now = new Date();
  const query = state.discountSearch.toLowerCase();
  const visible = state.discounts.filter((item) => {
    const expired = item.expiresAt && new Date(item.expiresAt) <= now;
    return (!query || `${item.code} ${item.name}`.toLowerCase().includes(query))
      && (state.discountFilter === "all"
        || (state.discountFilter === "active" && item.active && !item.archived && !expired)
        || (state.discountFilter === "expired" && expired)
        || (state.discountFilter === "archived" && item.archived));
  });
  const brandOptions = (selected = []) => sortedBrands().map((brand) => `<option value="${escapeHtml(brand.id)}" ${selected.includes(brand.id) ? "selected" : ""}>${escapeHtml(brand.name)}</option>`).join("");
  const productOptions = (selected = []) => state.content.products.map((product) => `<option value="${escapeHtml(product.id)}" ${selected.includes(product.id) ? "selected" : ""}>${escapeHtml(`${product.brand} ${product.name}`)}</option>`).join("");
  $("[data-list='discounts']").innerHTML = visible.map((item) => `
    <article class="editor-card" data-id="${escapeHtml(item.id)}" data-record="discounts">
      <div class="panel-heading"><div><h3>${escapeHtml(item.code || "New code")}<\/h3><small>${item.archived ? "Archived" : item.active ? "Active" : "Inactive"} · Used ${Number(item.timesUsed) || 0}${item.usageLimit ? ` / ${item.usageLimit}` : " times"}<\/small><\/div>
      <div class="row-actions"><button class="button secondary" type="button" data-discount-duplicate>Duplicate<\/button><button class="button secondary" type="button" data-discount-toggle>${item.active ? "Deactivate" : "Activate"}<\/button><button class="button danger" type="button" data-discount-delete>${item.timesUsed ? "Archive" : "Delete"}<\/button><\/div><\/div>
      <div class="form-grid">
        ${field("Promo code", item.code || "", "code")}${field("Internal name", item.name || "", "name")}${select("Discount type", item.type || "percentage", "type", [["percentage", "Percentage"], ["fixed", "Fixed amount"]])}
        ${field("Discount value", item.value || 0, "value", "number")}${checkbox("Active", item.active, "active")}${checkbox("Free delivery", item.freeDelivery, "freeDelivery")}
        ${field("Start date and time", item.startsAt || "", "startsAt", "datetime-local")}${field("Expiry date and time", item.expiresAt || "", "expiresAt", "datetime-local")}${field("Minimum order amount", item.minimumOrderAmount || 0, "minimumOrderAmount", "number")}
        ${field("Maximum discount amount", item.maximumDiscountAmount ?? "", "maximumDiscountAmount", "number")}${field("Total usage limit", item.usageLimit ?? "", "usageLimit", "number")}${field("Usage limit per customer", item.usageLimitPerCustomer ?? "", "usageLimitPerCustomer", "number")}
        ${field("Customer email restriction", item.customerEmail || "", "customerEmail", "email")}${checkbox("First order only", item.firstOrderOnly, "firstOrderOnly")}${select("Applies to", item.scope || "order", "scope", [["order","Entire order"],["brands","Selected brands"],["products","Selected products"],["categories","Selected categories"]])}
        <label>Selected brands<select multiple data-key="brandIds">${brandOptions(item.brandIds)}<\/select><\/label><label>Excluded brands<select multiple data-key="excludedBrandIds">${brandOptions(item.excludedBrandIds)}<\/select><\/label>
        <label>Selected products<select multiple data-key="productIds">${productOptions(item.productIds)}<\/select><\/label><label>Excluded products<select multiple data-key="excludedProductIds">${productOptions(item.excludedProductIds)}<\/select><\/label>
        ${field("Selected categories (comma-separated)", (item.categories || []).join(", "), "categoriesText", "text", "wide")}${field("Description", item.description || "", "description", "textarea", "wide")}
      </div></article>`).join("") || "<p>No discounts match this view.</p>";
};

const renderBrandManager = () => {
  const list = $("[data-brand-manager-list]");
  if (!list) return;
  list.innerHTML = `<div class="brand-manager-list">${sortedBrands().map((brand) => {
    const count = state.content.products.filter((product) => brandForProduct(product)?.id === brand.id).length;
    return `<article class="brand-row" data-brand-row="${escapeHtml(brand.id)}">
      <div class="brand-logo-preview">${brand.logo ? `<img src="${escapeHtml(adminImageSrc(brand.logo))}" alt="${escapeHtml(brand.name)} logo">` : `<span aria-hidden="true">${escapeHtml(brand.name.slice(0, 1))}</span>`}</div>
      <label>Brand name<input required data-brand-key="name" value="${escapeHtml(brand.name)}"></label>
      <label>Brand ID<input value="${escapeHtml(brand.id)}" disabled></label>
      <label>Display order<input type="number" min="1" step="1" data-brand-key="order" value="${Number(brand.order) || 1}"></label>
      <label class="check-row"><input type="checkbox" data-brand-key="active" ${brand.active !== false ? "checked" : ""}> Active</label>
      <label class="check-row"><input type="checkbox" data-brand-key="hideWhenEmpty" ${brand.hideWhenEmpty !== false ? "checked" : ""}> Hide when empty</label>
      <label>Logo (optional)<input type="file" accept="image/*" data-brand-logo></label>
      <div class="brand-row-actions"><small>${count} product${count === 1 ? "" : "s"}</small><button class="button danger" type="button" data-brand-delete="${escapeHtml(brand.id)}" ${count ? "disabled title=\"Move or delete this brand's products first\"" : ""}>Delete</button></div>
    </article>`;
  }).join("")}</div>`;
};

const openBrandManager = () => {
  renderBrandManager();
  const dialog = $("[data-brand-manager]");
  if (dialog?.showModal) dialog.showModal();
  else dialog?.setAttribute("open", "");
};

const closeBrandManager = () => {
  const dialog = $("[data-brand-manager]");
  if (dialog?.close) dialog.close();
  else dialog?.removeAttribute("open");
  renderProducts();
};

const render = () => {
  renderProducts();
  renderTreatments();
  renderGallery();
  renderVouchers();
  renderBookings();
  renderOrders();
  renderDiscounts();
  const settings = state.content.deliverySettings || {};
  const threshold = $("[data-delivery-setting='freeDeliveryThreshold']");
  const fee = $("[data-delivery-setting='standardPudoFee']");
  const collection = $("[data-delivery-setting='collectionEnabled']");
  if (threshold) threshold.value = settings.freeDeliveryThreshold ?? 1000;
  if (fee) fee.value = settings.standardPudoFee ?? 80;
  if (collection) collection.checked = settings.collectionEnabled !== false;
};

const loadAll = async () => {
  state.content = await request("content");
  state.content.products = (Array.isArray(state.content.products) ? state.content.products : []).map((product) => ({
    ...product,
    galleryImages: productGallery(product),
  }));
  state.bookings = await request("bookings");
  state.orders = await request("orders");
  state.discounts = await request("discounts");
  setDirty(false);
  render();
};

const showDashboard = async () => {
  setLoginStatus("");
  setStatus("");
  $("[data-login-panel]").hidden = true;
  $("[data-admin-portal]").hidden = false;
  if (window.location.hash !== "#dashboard") {
    window.location.hash = "dashboard";
  }
  try {
    await loadAll();
  } catch (error) {
    setStatus(error.message || "Dashboard data could not be loaded.", "error");
  }
};

const showLogin = () => {
  setLoginStatus("");
  setStatus("");
  $("[data-login-panel]").hidden = false;
  $("[data-admin-portal]").hidden = true;
  if (window.location.hash === "#dashboard") {
    history.replaceState(null, "", window.location.pathname);
  }
};

const addItem = (collection) => {
  const defaults = {
    products: { id: uid("product"), brandId: "", brand: "", category: "Needs review", name: "", price: 1, stockStatus: "In stock", image: "", imageAlt: "", galleryImages: [], hidden: true },
    treatments: { id: uid("treatment"), category: "General", name: "New treatment", price: "", duration: "", hidden: false },
    gallery: { id: uid("gallery"), title: "New result", category: "Microneedling", categories: "microneedling", order: state.content.gallery.length + 1, featured: false, hidden: false },
    vouchers: { id: uid("voucher"), name: "Gift Voucher", amount: 250, hidden: false },
  };
  state.content[collection].unshift(defaults[collection]);
  if (collection === "products") {
    state.productUi.mode = "edit";
    state.productUi.editingId = defaults.products.id;
    state.productUi.selectedIds.clear();
  }
  setDirty();
  render();
};

const applyProductBulkAction = (action) => {
  const selected = state.content.products.filter((product) => state.productUi.selectedIds.has(product.id));
  if (!selected.length) {
    setStatus("Select at least one product first.", "error");
    return;
  }
  const labels = {
    hide: "hide",
    show: "show",
    feature: "mark as featured",
    unfeature: "remove featured from",
    bestseller: "mark as best seller",
    unbestseller: "remove best seller from",
  };
  if (!confirm(`Are you sure you want to ${labels[action]} ${selected.length} selected product(s)?`)) return;
  selected.forEach((product) => {
    if (action === "hide") product.hidden = true;
    if (action === "show") product.hidden = false;
    if (action === "feature") product.featured = true;
    if (action === "unfeature") product.featured = false;
    if (action === "bestseller") product.bestSeller = true;
    if (action === "unbestseller") product.bestSeller = false;
    updateProductRow(product);
  });
  setDirty();
  updateProductSelectionSummary();
  setStatus(`${selected.length} product(s) updated. Remember to save changes.`, "success");
};

const validateProductsBeforeSave = () => {
  const products = Array.isArray(state.content.products) ? state.content.products : [];
  if (products.length < 65) {
    return "The product catalogue must contain all 65 products before saving.";
  }

  const brands = state.content.brands || [];
  const names = brands.map((brand) => String(brand.name || "").trim().toLowerCase());
  const ids = brands.map((brand) => String(brand.id || "").trim().toLowerCase());
  if (!brands.length) return "Add at least one brand before saving.";
  if (new Set(names).size !== brands.length || new Set(ids).size !== brands.length) return "Brand names and IDs must be unique.";
  const brandIds = new Set(brands.map((brand) => brand.id));

  const productIds = products.map((product) => String(product.id || "").trim().toLowerCase());
  const productSlugs = products.map((product) => slugify(product.slug || product.id));
  const productSkus = products.map((product) => String(product.sku || "").trim().toLowerCase());
  const duplicateId = productIds.find((id, index) => id && productIds.indexOf(id) !== index);
  if (duplicateId) return `Duplicate product ID detected: ${duplicateId}. Saving was blocked.`;
  const duplicateSlugIndex = productSlugs.findIndex((slug, index) => slug && productSlugs.indexOf(slug) !== index);
  if (duplicateSlugIndex >= 0) return `Duplicate product slug detected: ${products[duplicateSlugIndex].id}. Saving was blocked.`;
  const duplicateSkuIndex = productSkus.findIndex((sku, index) => sku && productSkus.indexOf(sku) !== index);
  if (duplicateSkuIndex >= 0) return `Duplicate product SKU detected: ${products[duplicateSkuIndex].sku}. Saving was blocked.`;

  const invalid = products.find((product) => {
    const price = Number(product.price);
    const selectedBrand = brands.find((brand) => brand.id === product.brandId);
    const gallery = productGallery(product);
    return !product.id?.trim()
      || !/^[a-z0-9][a-z0-9_-]*$/.test(product.id)
      || !product.name?.trim()
      || !product.brand?.trim()
      || !brandIds.has(product.brandId)
      || product.brand !== selectedBrand?.name
      || invalidProductImage(product.image)
      || gallery.some((image) => !image.id || invalidProductImage(image.url))
      || new Set(gallery.map((image) => image.id.toLowerCase())).size !== gallery.length
      || !Number.isFinite(price)
      || price <= 0;
  });
  if (invalid) {
    if (!invalid.brandId || !brandIds.has(invalid.brandId)) return `Select a brand for ${invalid.name || invalid.id || "the new product"}. Saving was blocked.`;
    if (invalidProductImage(invalid.image)) return `Upload a valid main image for ${invalid.name || invalid.id || "the new product"}. Placeholder or blank images cannot be saved.`;
    return `Please complete the product ID, name, brand, images and a valid price before saving: ${invalid.name || invalid.id || "Unnamed product"}.`;
  }

  return "";
};

const verifyPersistedContent = (expected, actual) => {
  const expectedProducts = Array.isArray(expected?.products) ? expected.products : [];
  const actualProducts = Array.isArray(actual?.products) ? actual.products : [];
  const actualById = new Map(actualProducts.map((product) => [String(product.id || "").toLowerCase(), product]));
  const fields = [
    "name", "slug", "sku", "brandId", "brand", "category", "size", "price", "stockStatus",
    "image", "imageAlt", "benefit", "description", "directions", "ingredients", "suitable",
    "tags", "relatedProducts", "seoTitle", "seoDescription", "searchKeywords", "featured",
    "bestSeller", "hidden", "active", "published", "status",
  ];
  for (const product of expectedProducts) {
    const persisted = actualById.get(String(product.id || "").toLowerCase());
    if (!persisted) return `Saved product could not be reloaded: ${product.name || product.id}.`;
    const mismatchedField = fields.find((field) => JSON.stringify(persisted[field]) !== JSON.stringify(product[field]));
    if (mismatchedField) return `Saved ${mismatchedField} could not be verified for ${product.name || product.id}.`;
    if (JSON.stringify(productGallery(persisted)) !== JSON.stringify(productGallery(product))) return `Saved gallery images could not be verified for ${product.name || product.id}.`;
  }
  return "";
};

const reloadPersistedContent = async (submitted, timeoutMs = 65000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = "Saved content has not propagated yet.";
  while (Date.now() < deadline) {
    const authoritative = await request("content", { headers: { "Cache-Control": "no-cache" } });
    const verificationError = verifyPersistedContent(submitted, authoritative);
    if (!verificationError) return authoritative;
    lastError = verificationError;
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
  throw new Error(`${lastError} Refresh and verify the catalogue before making further changes.`);
};

const persistWebsiteContent = async (successMessage) => {
  if (state.saving) return;
  if (state.pendingUploads.size) {
    setStatus("Wait for all image uploads to finish before saving.", "error");
    return;
  }
  const validationError = validateProductsBeforeSave();
  if (validationError) {
    setStatus(validationError, "error");
    return;
  }

  const submitted = JSON.parse(JSON.stringify(state.content));
  setSavingState(true);
  setStatus("Saving product data and image references…");
  try {
    await request("content", { method: "PUT", body: JSON.stringify(submitted) });
    const authoritative = await reloadPersistedContent(submitted);
    state.content = authoritative;
    state.content.products = state.content.products.map((product) => ({ ...product, galleryImages: productGallery(product) }));
    setDirty(false);
    render();
    setStatus(successMessage, "success");
  } catch (error) {
    console.error("[Admin content save] Persistence verification failed", error);
    setStatus(error.message || "The catalogue could not be saved and verified. Please try again.", "error");
  } finally {
    setSavingState(false);
  }
};

const updateRecord = (card, key, value) => {
  const collection = card.dataset.collection;
  const recordType = card.dataset.record;
  const id = card.dataset.id;
  const source = collection ? state.content[collection] : state[recordType];
  const item = source.find((entry) => entry.id === id);
  if (!item) return;

  if (["price", "amount", "order", "total", "value", "minimumOrderAmount", "maximumDiscountAmount", "usageLimit", "usageLimitPerCustomer"].includes(key)) item[key] = value === "" ? null : Number(value) || 0;
  else if (["brandIds", "productIds", "excludedBrandIds", "excludedProductIds"].includes(key)) item[key] = Array.isArray(value) ? value : [];
  else if (key === "categoriesText") item.categories = String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  else if (key === "tags" || key === "relatedProducts") {
    item[key] = String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  } else if (key === "id" && collection !== "products") {
    item.id = String(value || "").trim();
    card.dataset.id = item.id;
  } else if (key === "customerText") {
    try { item.customer = JSON.parse(value || "{}"); } catch { item.customer = {}; }
  } else if (key === "productsText") {
    try { item.products = JSON.parse(value || "[]"); } catch { item.products = []; }
  } else if (collection === "products" && key === "brandId") {
    const brand = state.content.brands.find((entry) => entry.id === value);
    if (brand) {
      item.brandId = brand.id;
      item.brand = brand.name;
    }
  } else item[key] = value;

  if (collection || recordType === "discounts") setDirty();
};

const handleUploadInput = async (input) => {
  const card = input.closest?.(".editor-card");
  if (!card || !input.files?.[0]) return false;
  if (input.matches("[data-upload], [data-gallery-upload-id], [data-gallery-upload-new]") && input.files?.[0]) {
    if (input.dataset.uploading === "true") return true;
    const productId = card.dataset.id;
    const targetProduct = getProductById(productId);
    if (!targetProduct) {
      setStatus("The product being edited could not be identified. Reopen it and try again.", "error");
      return true;
    }
    const galleryUpload = input.matches("[data-gallery-upload-id], [data-gallery-upload-new]");
    const imageId = galleryUpload ? (input.dataset.galleryUploadId || uid("image")) : "";
    const uploadToken = `${productId}:${galleryUpload ? imageId : "main"}:${uid("upload")}`;
    input.dataset.uploading = "true";
    state.pendingUploads.set(uploadToken, { productId, imageId });
    setStatus(`Uploading and verifying image for ${targetProduct.name || productId}…`);
    try {
      const url = await uploadImage(input.files[0], {
        ownerType: "product",
        ownerId: productId,
        slot: galleryUpload ? "gallery" : "main",
        imageId,
      });
      const persistedTarget = getProductById(productId);
      if (!persistedTarget) throw new Error("The product was closed or removed before its image upload completed.");
      if (galleryUpload) {
        persistedTarget.galleryImages = productGallery(persistedTarget);
        const existing = persistedTarget.galleryImages.find((image) => image.id === imageId);
        if (existing) existing.url = url;
        else persistedTarget.galleryImages.push({ id: imageId, url, alt: "" });
      } else {
        persistedTarget.image = url;
      }
      setDirty();
      setStatus("Image uploaded and verified. Save changes to publish it.");
      render();
    } catch (error) {
      console.error("[Admin image upload] Product image upload failed", error);
      setStatus(error.message || "Image upload failed.", "error");
    } finally {
      state.pendingUploads.delete(uploadToken);
      input.dataset.uploading = "false";
    }
    return true;
  }
  return false;
};

document.addEventListener("input", async (event) => {
  const input = event.target;

  if (input.type === "file") return;

  if (input.matches("[data-delivery-setting]")) {
    state.content.deliverySettings ||= { freeDeliveryThreshold: 1000, standardPudoFee: 80, collectionEnabled: true };
    state.content.deliverySettings[input.dataset.deliverySetting] = input.type === "checkbox" ? input.checked : Math.max(0, Number(input.value) || 0);
    setDirty();
    return;
  }

  if (input.matches("[data-product-quick]")) {
    updateProductQuickControl(input);
    return;
  }

  if (input.matches("[data-product-search]")) {
    state.productUi.search = input.value;
    state.productUi.selectedIds.clear();
    renderProducts();
    const searchInput = $("[data-product-search]");
    searchInput?.focus();
    searchInput?.setSelectionRange?.(state.productUi.search.length, state.productUi.search.length);
    return;
  }

  if (input.matches("[data-discount-search]")) {
    state.discountSearch = input.value;
    renderDiscounts();
    const search = $("[data-discount-search]");
    search?.focus();
    search?.setSelectionRange?.(state.discountSearch.length, state.discountSearch.length);
    return;
  }

  const card = input.closest?.(".editor-card");
  if (!card) return;
  if (await handleUploadInput(input)) return;

  if (input.matches("[data-gallery-key]")) {
    const product = getProductById(card.dataset.id);
    const image = productGallery(product).find((entry) => entry.id === input.dataset.galleryId);
    if (product && image) {
      product.galleryImages = productGallery(product);
      const target = product.galleryImages.find((entry) => entry.id === input.dataset.galleryId);
      target[input.dataset.galleryKey] = input.value;
      setDirty();
    }
    return;
  }

  const key = input.dataset.key;
  if (!key) return;
  updateRecord(card, key, input.multiple ? Array.from(input.selectedOptions, (option) => option.value) : input.type === "checkbox" ? input.checked : input.value);
});

document.addEventListener("change", async (event) => {
  const input = event.target;
  if (input.matches("[data-discount-filter]")) {
    state.discountFilter = input.value;
    renderDiscounts();
    return;
  }
  if (input.matches("[data-brand-key]")) {
    const row = input.closest("[data-brand-row]");
    const brand = state.content.brands.find((item) => item.id === row?.dataset.brandRow);
    if (!brand) return;
    const key = input.dataset.brandKey;
    const value = input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) || 1 : input.value.trim();
    if (key === "name") {
      if (!value || state.content.brands.some((item) => item.id !== brand.id && item.name.toLowerCase() === value.toLowerCase())) {
        setStatus("Brand names must be present and unique.", "error");
        input.value = brand.name;
        return;
      }
      brand.name = value;
      state.content.products.filter((product) => product.brandId === brand.id).forEach((product) => { product.brand = value; });
    } else brand[key] = value;
    setDirty();
    renderBrandManager();
    return;
  }

  if (input.matches("[data-brand-logo]") && input.files?.[0]) {
    const brand = state.content.brands.find((item) => item.id === input.closest("[data-brand-row]")?.dataset.brandRow);
    if (!brand) return;
    setStatus("Uploading brand logo…");
    try {
      brand.logo = await uploadImage(input.files[0], { ownerType: "brand", ownerId: brand.id, slot: "logo", imageId: "" });
      setDirty();
      renderBrandManager();
      setStatus("Brand logo uploaded.", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
    return;
  }

  if (input.matches("[data-key='brandId']") && input.value === "__add_brand__") {
    input.value = input.closest(".editor-card")?.dataset.id ? getProductById(input.closest(".editor-card").dataset.id)?.brandId || "" : "";
    openBrandManager();
    return;
  }
  if (input.matches("[data-product-filter]")) {
    state.productUi[input.dataset.productFilter] = input.value;
    state.productUi.selectedIds.clear();
    renderProducts({ preserveScroll: true });
    return;
  }

  if (input.matches("[data-product-select]")) {
    if (input.checked) state.productUi.selectedIds.add(input.dataset.productSelect);
    else state.productUi.selectedIds.delete(input.dataset.productSelect);
    updateProductSelectionSummary();
    return;
  }

  if (input.matches("[data-product-select-all]")) {
    const filteredProducts = getFilteredProducts();
    filteredProducts.forEach((product) => {
      if (input.checked) state.productUi.selectedIds.add(product.id);
      else state.productUi.selectedIds.delete(product.id);
    });
    $$("[data-product-select]").forEach((checkbox) => {
      checkbox.checked = state.productUi.selectedIds.has(checkbox.dataset.productSelect);
    });
    updateProductSelectionSummary();
    return;
  }

  if (input.matches("[data-product-quick]")) {
    updateProductQuickControl(input);
    return;
  }

  if (input.matches("[data-upload], [data-gallery-upload-id], [data-gallery-upload-new]")) {
    await handleUploadInput(input);
    return;
  }

  const card = input.closest?.(".editor-card");
  const key = input.dataset.key;
  if (card && key) {
    updateRecord(card, key, input.type === "checkbox" ? input.checked : input.value);
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (target.closest?.("[data-product-quick]")) return;

  if (target.matches("[data-tab]")) {
    if (state.dirty && !confirm("You have unsaved changes. Switch sections anyway?")) return;
    $$(".tabs button").forEach((button) => button.classList.toggle("is-active", button === target));
    $$(".panel").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === target.dataset.tab));
  }

  if (target.matches("[data-add]")) addItem(target.dataset.add);

  if (target.matches("[data-add-discount]")) {
    state.discounts.unshift({ id: uid("discount"), code: "", name: "New promotion", description: "", type: "percentage", value: 10, active: true, startsAt: "", expiresAt: "", minimumOrderAmount: 0, maximumDiscountAmount: null, usageLimit: null, usageLimitPerCustomer: null, customerEmail: "", firstOrderOnly: false, scope: "order", brandIds: [], productIds: [], categories: [], excludedBrandIds: [], excludedProductIds: [], freeDelivery: false, timesUsed: 0 });
    setDirty();
    renderDiscounts();
  }

  if (target.matches("[data-discount-duplicate], [data-discount-toggle], [data-discount-delete]")) {
    const card = target.closest("[data-record='discounts']");
    const item = state.discounts.find((discount) => discount.id === card?.dataset.id);
    if (!item) return;
    if (target.matches("[data-discount-duplicate]")) state.discounts.unshift({ ...item, id: uid("discount"), code: `${item.code}-COPY`, name: `${item.name} copy`, active: false, archived: false, timesUsed: 0 });
    if (target.matches("[data-discount-toggle]")) item.active = !item.active;
    if (target.matches("[data-discount-delete]") && confirm(`${item.timesUsed ? "Archive" : "Delete"} ${item.code || "this discount"}?`)) {
      if (item.timesUsed) { item.archived = true; item.active = false; } else state.discounts = state.discounts.filter((discount) => discount.id !== item.id);
    }
    setDirty();
    renderDiscounts();
  }

  if (target.matches("[data-product-brand-tab]")) {
    state.productUi.brand = target.dataset.productBrandTab;
    state.productUi.selectedIds.clear();
    renderProducts({ preserveScroll: true });
  }

  if (target.matches("[data-manage-brands]")) openBrandManager();
  if (target.matches("[data-brand-manager-close]")) closeBrandManager();
  if (target.matches("[data-brand-add]")) {
    let baseName = "New Brand";
    let name = baseName;
    let suffix = 2;
    while (state.content.brands.some((brand) => brand.name.toLowerCase() === name.toLowerCase())) name = `${baseName} ${suffix++}`;
    let id = slugify(name);
    suffix = 2;
    while (state.content.brands.some((brand) => brand.id === id)) id = `${slugify(name)}-${suffix++}`;
    state.content.brands.push({ id, name, order: state.content.brands.length + 1, active: true, logo: "", hideWhenEmpty: true });
    setDirty();
    renderBrandManager();
  }
  if (target.matches("[data-brand-delete]")) {
    const brand = state.content.brands.find((item) => item.id === target.dataset.brandDelete);
    const count = state.content.products.filter((product) => product.brandId === brand?.id).length;
    if (!brand || count) {
      setStatus("Brands with products cannot be deleted.", "error");
      return;
    }
    if (confirm(`Delete ${brand.name}?`)) {
      state.content.brands = state.content.brands.filter((item) => item.id !== brand.id);
      setDirty();
      renderBrandManager();
    }
  }

  if (target.matches("[data-product-filters-toggle]")) {
    state.productUi.filtersOpen = !state.productUi.filtersOpen;
    renderProducts();
  }

  if (target.matches("[data-product-back]")) {
    state.productUi.mode = "list";
    state.productUi.editingId = "";
    renderProducts();
  }

  const productEditButton = target.closest?.("[data-product-edit]");
  if (productEditButton) {
    state.productUi.mode = "edit";
    state.productUi.editingId = productEditButton.dataset.productEdit;
    renderProducts();
  }

  if (target.matches("[data-product-hide]")) {
    const item = getProductById(target.dataset.productHide);
    if (item && confirm(`${item.hidden ? "Show" : "Hide"} this product?`)) {
      item.hidden = !item.hidden;
      setDirty();
      updateProductRow(item);
    }
  }

  if (target.matches("[data-product-delete]")) {
    const item = getProductById(target.dataset.productDelete);
    if (item && confirm(`Delete ${item.name || "this product"} permanently?`)) {
      state.content.products = state.content.products.filter((product) => product.id !== item.id);
      state.productUi.selectedIds.delete(item.id);
      setDirty();
      renderProducts();
    }
  }

  if (target.matches("[data-product-bulk]")) applyProductBulkAction(target.dataset.productBulk);

  if (target.matches("[data-product-toggle]")) {
    const item = getProductById(target.dataset.productToggle);
    if (item) {
      item[target.dataset.productKey] = !item[target.dataset.productKey];
      setDirty();
      updateProductRow(item);
    }
    return;
  }

  if (target.matches("[data-gallery-remove]")) {
    const product = getProductById(target.closest(".editor-card")?.dataset.id);
    if (product) {
      product.galleryImages = productGallery(product).filter((image) => image.id !== target.dataset.galleryRemove);
      setDirty();
      render();
      setStatus("Gallery image removed. Save changes to publish it.");
    }
    return;
  }

  const card = target.closest?.(".editor-card");
  if (card?.dataset.collection && target.matches("[data-hide]")) {
    const collection = card.dataset.collection;
    const item = state.content[collection].find((entry) => entry.id === card.dataset.id);
    if (item && confirm(`${item.hidden ? "Show" : "Hide"} this item?`)) {
      item.hidden = !item.hidden;
      setDirty();
      render();
    }
  }

  if (card?.dataset.collection && target.matches("[data-delete]")) {
    const collection = card.dataset.collection;
    if (confirm("Delete this item permanently?")) {
      state.content[collection] = state.content[collection].filter((entry) => entry.id !== card.dataset.id);
      setDirty();
      render();
    }
  }

  if (target.matches("[data-save]")) {
    await persistWebsiteContent("Website content saved and verified.");
  }

  if (target.matches("[data-save-bookings]")) {
    await request("bookings", { method: "PUT", body: JSON.stringify({ items: state.bookings }) });
    setStatus("Booking statuses saved.", "success");
  }

  if (target.matches("[data-save-orders]")) {
    await request("orders", { method: "PUT", body: JSON.stringify({ items: state.orders }) });
    setStatus("Order statuses saved.", "success");
  }

  if (target.matches("[data-save-discounts]")) {
    try {
      const result = await request("discounts", { method: "PUT", body: JSON.stringify({ items: state.discounts }) });
      state.discounts = result.items;
      setDirty(false);
      renderDiscounts();
      setStatus("Discounts saved.", "success");
    } catch (error) { setStatus(error.message, "error"); }
  }

  if (target.matches("[data-save-delivery]")) {
    await persistWebsiteContent("Delivery settings saved and verified.");
  }

  if (target.matches("[data-refresh]")) loadAll().catch((error) => setStatus(error.message, "error"));

  if (target.matches("[data-logout]")) {
    try {
      await request("logout", { method: "POST", body: "{}" });
    } finally {
      state.content = { brands: [], products: [], treatments: [], gallery: [], vouchers: [], deliverySettings: { freeDeliveryThreshold: 1000, standardPudoFee: 80, collectionEnabled: true } };
      state.bookings = [];
      state.orders = [];
      state.dirty = false;
      setLoginStatus("");
      showLogin();
    }
  }
});

$("[data-login-form]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  setLoginStatus("Signing in…");
  try {
    await request("login", {
      method: "POST",
      body: JSON.stringify({
        username: formData.get("username"),
        password: formData.get("password"),
      }),
    });
    await showDashboard();
  } catch (error) {
    showLogin();
    setLoginStatus(error.message || "Request failed", "error");
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

request("me")
  .then((session) => session?.authenticated === false ? showLogin() : showDashboard())
  .catch(() => {
    showLogin();
  });
