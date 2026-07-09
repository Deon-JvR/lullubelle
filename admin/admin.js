const API = "/.netlify/functions/admin-api";

const state = {
  content: { products: [], treatments: [], gallery: [], vouchers: [] },
  bookings: [],
  orders: [],
  dirty: false,
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
  },
};

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

const uid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
const money = (value) => Number(value || 0);
const REQUIRED_PRODUCT_BRANDS = ["Kalahari", "VitaDerm", "Mesoestetic"];
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
  const response = await fetch(`${API}?action=${encodeURIComponent(action)}`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
};

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

const convertImageToWebP = async (file) => {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") return null;

  const image = await createImageBitmap(file).catch(() => null);
  if (!image) return null;

  const maxSize = 1800;
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(image, 0, 0, width, height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.88));
  image.close?.();
  return blob;
};

const uploadImage = async (file) => {
  const webp = await convertImageToWebP(file);
  const uploadFile = webp || file;
  const filename = webp ? `${file.name.replace(/\.[^.]+$/, "")}.webp` : file.name;
  const mimeType = webp ? "image/webp" : file.type;
  const dataUrl = await blobToDataUrl(uploadFile);
  const result = await request("upload", {
    method: "POST",
    body: JSON.stringify({ filename, mimeType, base64: dataUrl }),
  });
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
      ${options.map((option) => `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
    </select>
  </label>`;

const checkbox = (label, checked, key) => `
  <label class="check-row"><input type="checkbox" data-key="${escapeHtml(key)}" ${checked ? "checked" : ""}> ${escapeHtml(label)}</label>`;

const productVisibilityLabel = (product) => product.hidden ? "Hidden" : "Visible";
const productBadge = (label, active, tone = "") => `<span class="status-pill ${active ? "is-active" : ""} ${tone}">${escapeHtml(label)}</span>`;
const adminImageSrc = (image) => {
  const value = String(image || "").trim();
  if (!value) return "lullubelle-logo.jpg";
  if (/^(https?:|data:|blob:|\/)/i.test(value)) return value;
  return `/${value.replace(/^\.?\//, "")}`;
};
const productBadges = (product) => {
  const badges = [];
  if (product.featured) badges.push(productBadge("Featured", true));
  if (product.bestSeller) badges.push(productBadge("Best Seller", true));
  return badges.join(" ") || productBadge("None", false);
};

const getProductById = (id) => state.content.products.find((product) => product.id === id);

const getFilteredProducts = () => {
  const ui = state.productUi;
  const search = ui.search.trim().toLowerCase();
  return [...state.content.products]
    .filter((product) => {
      const name = String(product.name || "").toLowerCase();
      const brand = String(product.brand || "");
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
      return (!search || name.includes(search))
        && (ui.brand === "all" || brand === ui.brand)
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
  const brands = [...new Set(products.map((product) => product.brand).filter(Boolean))].sort();
  const filterSelect = (label, key, value, options) => `
    <label>${escapeHtml(label)}
      <select data-product-filter="${escapeHtml(key)}">
        ${options.map(([optionValue, optionLabel]) => `<option value="${escapeHtml(optionValue)}" ${optionValue === value ? "selected" : ""}>${escapeHtml(optionLabel)}</option>`).join("")}
      </select>
    </label>`;

  return `
    <div class="product-tools">
      <label class="product-search">Search products
        <input type="search" data-product-search value="${escapeHtml(state.productUi.search)}" placeholder="Search by product name">
      </label>
      ${filterSelect("Brand", "brand", state.productUi.brand, [["all", "All brands"], ...brands.map((brand) => [brand, brand])])}
      ${filterSelect("Stock", "stock", state.productUi.stock, [["all", "All stock"], ...STOCK_STATUSES.map((status) => [status, status])])}
      ${filterSelect("Visibility", "visibility", state.productUi.visibility, [["all", "All"], ["visible", "Visible"], ["hidden", "Hidden"]])}
      ${filterSelect("Featured", "featured", state.productUi.featured, [["all", "All"], ["yes", "Featured"], ["no", "Not featured"]])}
      ${filterSelect("Best seller", "bestSeller", state.productUi.bestSeller, [["all", "All"], ["yes", "Best sellers"], ["no", "Not best sellers"]])}
      ${filterSelect("Sort", "sort", state.productUi.sort, PRODUCT_SORTS)}
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
              <td data-label="Image"><img class="product-list-thumb" src="${escapeHtml(adminImageSrc(product.image))}" alt="${escapeHtml(product.imageAlt || product.name || "Product image")}" loading="lazy"></td>
              <td data-label="Product">
                <div class="product-row-title">
                  <div>
                    <strong>${escapeHtml(product.name || "Unnamed product")}</strong>
                    <small>${escapeHtml(product.id || "")}</small>
                  </div>
                </div>
              </td>
              <td data-label="Brand">${escapeHtml(product.brand || "Needs review")}</td>
              <td data-label="Price">R${money(product.price).toLocaleString("en-ZA")}</td>
              <td data-label="Stock">${productBadge(product.stockStatus || "In stock", product.stockStatus !== "Out of stock", "stock")}</td>
              <td data-label="Badges"><div class="badge-stack">${productBadges(product)}</div></td>
              <td data-label="Visibility">${productBadge(productVisibilityLabel(product), !product.hidden, product.hidden ? "hidden" : "visible")}</td>
              <td data-label="Actions">
                <div class="row-actions">
                  <button class="button secondary" type="button" data-product-edit="${escapeHtml(product.id)}">Edit</button>
                  <button class="button secondary" type="button" data-product-hide="${escapeHtml(product.id)}">${product.hidden ? "Show" : "Hide"}</button>
                  <button class="button danger" type="button" data-product-delete="${escapeHtml(product.id)}">Delete</button>
                </div>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
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
          ${field("Product ID / slug", product.id, "id")}
          ${select("Brand", product.brand || "Kalahari", "brand", ["Kalahari", "VitaDerm", "Mesoestetic"])}
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
          ${field("SEO meta description", product.seoDescription || product.metaDescription || "", "seoDescription", "textarea", "wide")}
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

const renderProducts = () => {
  const list = $("[data-list='products']");
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
};

const renderTreatments = () => {
  $("[data-list='treatments']").innerHTML = state.content.treatments.map((item) => cardShell(item, "treatments", item.name || "New treatment", `
    ${field("Category", item.category || "", "category")}
    ${field("Treatment name", item.name, "name")}
    ${field("Price", item.price || "", "price")}
    ${field("Duration", item.duration || "", "duration")}
    ${checkbox("Featured treatment", item.featured, "featured")}
    ${field("Description", item.description || "", "description", "textarea", "wide")}
  `, "")).join("") || `<p>No treatments were found in the shared website catalogue.</p>`;
};

const renderGallery = () => {
  $("[data-list='gallery']").innerHTML = state.content.gallery.map((item) => cardShell(item, "gallery", item.title || "New gallery item", `
    ${field("Title", item.title, "title")}
    ${field("Treatment category", item.category || "microneedling", "category")}
    ${field("Filter keywords", item.categories || "", "categories")}
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
        ${field("Total", item.total || 0, "total", "number")}
        ${select("Payment status", item.paymentStatus || "Pending", "paymentStatus", ["Pending", "Paid", "Failed", "Refunded"])}
        ${select("Order status", item.orderStatus || "New", "orderStatus", ["New", "Processing", "Ready", "Completed", "Cancelled"])}
      </div>
    </article>`).join("") || `<p>No orders have been captured yet.</p>`;
};

const render = () => {
  renderProducts();
  renderTreatments();
  renderGallery();
  renderVouchers();
  renderBookings();
  renderOrders();
};

const loadAll = async () => {
  state.content = await request("content");
  state.bookings = await request("bookings");
  state.orders = await request("orders");
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
    products: { id: uid("product"), brand: "Kalahari", category: "Needs review", name: "New product", price: 1, stockStatus: "In stock", image: "lullubelle-logo.jpg", hidden: false },
    treatments: { id: uid("treatment"), category: "General", name: "New treatment", price: "", duration: "", hidden: false },
    gallery: { id: uid("gallery"), title: "New result", category: "Microneedling", categories: "microneedling", hidden: false },
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
  });
  setDirty();
  renderProducts();
  setStatus(`${selected.length} product(s) updated. Remember to save changes.`, "success");
};

const validateProductsBeforeSave = () => {
  const products = Array.isArray(state.content.products) ? state.content.products : [];
  if (products.length < 61) {
    return "The product catalogue must contain all 61 products before saving.";
  }

  const brands = new Set(products.map((product) => product.brand).filter(Boolean));
  const missingBrands = REQUIRED_PRODUCT_BRANDS.filter((brand) => !brands.has(brand));
  if (missingBrands.length) {
    return `The product catalogue is missing required brand(s): ${missingBrands.join(", ")}.`;
  }

  const invalid = products.find((product) => {
    const price = Number(product.price);
    return !product.name?.trim()
      || !product.brand?.trim()
      || !product.image?.trim()
      || !Number.isFinite(price)
      || price <= 0;
  });
  if (invalid) {
    return `Please complete product name, brand, image and a valid price before saving: ${invalid.name || invalid.id || "Unnamed product"}.`;
  }

  return "";
};

const updateRecord = (card, key, value) => {
  const collection = card.dataset.collection;
  const recordType = card.dataset.record;
  const id = card.dataset.id;
  const source = collection ? state.content[collection] : state[recordType];
  const item = source.find((entry) => entry.id === id);
  if (!item) return;

  if (key === "price" || key === "amount" || key === "total") item[key] = Number(value) || 0;
  else if (key === "tags" || key === "relatedProducts") {
    item[key] = String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  } else if (key === "id") {
    item.id = String(value || "").trim();
    card.dataset.id = item.id;
    if (collection === "products") state.productUi.editingId = item.id;
  }
  else if (key === "customerText") {
    try { item.customer = JSON.parse(value || "{}"); } catch { item.customer = {}; }
  } else if (key === "productsText") {
    try { item.products = JSON.parse(value || "[]"); } catch { item.products = []; }
  } else item[key] = value;

  if (collection) setDirty();
};

const handleUploadInput = async (input) => {
  const card = input.closest?.(".editor-card");
  if (!card || !input.files?.[0]) return false;
  if (input.matches("[data-upload]") && input.files?.[0]) {
    setStatus("Uploading image…");
    try {
      const url = await uploadImage(input.files[0]);
      updateRecord(card, input.dataset.upload, url);
      setDirty();
      setStatus("Image uploaded.", "success");
      render();
    } catch (error) {
      setStatus(error.message, "error");
    }
    return true;
  }
  return false;
};

document.addEventListener("input", async (event) => {
  const input = event.target;

  if (input.matches("[data-product-search]")) {
    state.productUi.search = input.value;
    state.productUi.selectedIds.clear();
    renderProducts();
    const searchInput = $("[data-product-search]");
    searchInput?.focus();
    searchInput?.setSelectionRange?.(state.productUi.search.length, state.productUi.search.length);
    return;
  }

  const card = input.closest?.(".editor-card");
  if (!card) return;
  if (await handleUploadInput(input)) return;

  const key = input.dataset.key;
  if (!key) return;
  updateRecord(card, key, input.type === "checkbox" ? input.checked : input.value);
});

document.addEventListener("change", async (event) => {
  const input = event.target;
  if (input.matches("[data-product-filter]")) {
    state.productUi[input.dataset.productFilter] = input.value;
    state.productUi.selectedIds.clear();
    renderProducts();
    return;
  }

  if (input.matches("[data-product-select]")) {
    if (input.checked) state.productUi.selectedIds.add(input.dataset.productSelect);
    else state.productUi.selectedIds.delete(input.dataset.productSelect);
    renderProducts();
    return;
  }

  if (input.matches("[data-product-select-all]")) {
    const filteredProducts = getFilteredProducts();
    filteredProducts.forEach((product) => {
      if (input.checked) state.productUi.selectedIds.add(product.id);
      else state.productUi.selectedIds.delete(product.id);
    });
    renderProducts();
    return;
  }

  if (input.matches("[data-upload]")) {
    await handleUploadInput(input);
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (target.matches("[data-tab]")) {
    if (state.dirty && !confirm("You have unsaved changes. Switch sections anyway?")) return;
    $$(".tabs button").forEach((button) => button.classList.toggle("is-active", button === target));
    $$(".panel").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === target.dataset.tab));
  }

  if (target.matches("[data-add]")) addItem(target.dataset.add);

  if (target.matches("[data-product-back]")) {
    state.productUi.mode = "list";
    state.productUi.editingId = "";
    renderProducts();
  }

  if (target.matches("[data-product-edit]")) {
    state.productUi.mode = "edit";
    state.productUi.editingId = target.dataset.productEdit;
    renderProducts();
  }

  if (target.matches("[data-product-hide]")) {
    const item = getProductById(target.dataset.productHide);
    if (item && confirm(`${item.hidden ? "Show" : "Hide"} this product?`)) {
      item.hidden = !item.hidden;
      setDirty();
      renderProducts();
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
    const validationError = validateProductsBeforeSave();
    if (validationError) {
      setStatus(validationError, "error");
      return;
    }

    setStatus("Saving…");
    try {
      state.content = await request("content", { method: "PUT", body: JSON.stringify(state.content) });
      setDirty(false);
      render();
      setStatus("Website content saved.", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  }

  if (target.matches("[data-save-bookings]")) {
    await request("bookings", { method: "PUT", body: JSON.stringify({ items: state.bookings }) });
    setStatus("Booking statuses saved.", "success");
  }

  if (target.matches("[data-save-orders]")) {
    await request("orders", { method: "PUT", body: JSON.stringify({ items: state.orders }) });
    setStatus("Order statuses saved.", "success");
  }

  if (target.matches("[data-refresh]")) loadAll().catch((error) => setStatus(error.message, "error"));

  if (target.matches("[data-logout]")) {
    try {
      await request("logout", { method: "POST", body: "{}" });
    } finally {
      state.content = { products: [], treatments: [], gallery: [], vouchers: [] };
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
  .then(showDashboard)
  .catch(() => {
    showLogin();
  });
