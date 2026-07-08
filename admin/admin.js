const API = "/.netlify/functions/admin-api";

const state = {
  content: { products: [], treatments: [], gallery: [], vouchers: [] },
  bookings: [],
  orders: [],
  dirty: false,
};

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

const uid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
const money = (value) => Number(value || 0);
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
  $("[data-list='products']").innerHTML = state.content.products.map((item) => cardShell(item, "products", item.name || "New product", `
    ${field("Product name", item.name, "name")}
    ${select("Brand", item.brand || "Kalahari", "brand", ["Kalahari", "VitaDerm", "Mesoestetic"])}
    ${field("Price", item.price || 0, "price", "number")}
    ${select("Stock status", item.stockStatus || "In stock", "stockStatus", ["In stock", "Out of stock", "Coming soon"])}
    ${checkbox("Featured product", item.featured, "featured")}
    ${checkbox("Best seller", item.bestSeller, "bestSeller")}
    ${field("Short benefit", item.benefit || "", "benefit", "textarea", "wide")}
    ${field("Description", item.description || "", "description", "textarea", "wide")}
    ${field("Image URL", item.image || "", "image", "text", "wide")}
    <label class="wide">Upload/change image <input type="file" accept="image/*" data-upload="image"></label>
  `)).join("") || `<p>No managed products yet. Existing static products remain visible until you add managed products.</p>`;
};

const renderTreatments = () => {
  $("[data-list='treatments']").innerHTML = state.content.treatments.map((item) => cardShell(item, "treatments", item.name || "New treatment", `
    ${field("Treatment name", item.name, "name")}
    ${field("Price", item.price || "", "price")}
    ${field("Duration", item.duration || "", "duration")}
    ${checkbox("Featured treatment", item.featured, "featured")}
    ${field("Description", item.description || "", "description", "textarea", "wide")}
  `, "")).join("") || `<p>No managed treatments yet.</p>`;
};

const renderGallery = () => {
  $("[data-list='gallery']").innerHTML = state.content.gallery.map((item) => cardShell(item, "gallery", item.title || "New gallery item", `
    ${field("Title", item.title, "title")}
    ${field("Treatment category", item.category || "microneedling", "category")}
    ${field("Number of treatments", item.treatments || "", "treatments")}
    ${checkbox("Featured result", item.featured, "featured")}
    ${field("Description", item.description || "", "description", "textarea", "wide")}
    ${field("Image URL", item.image || "", "image", "text", "wide")}
    <label class="wide">Upload before/after image <input type="file" accept="image/*" data-upload="image"></label>
  `)).join("") || `<p>No managed gallery items yet. Static approved results remain visible.</p>`;
};

const renderVouchers = () => {
  $("[data-list='vouchers']").innerHTML = state.content.vouchers.map((item) => cardShell(item, "vouchers", item.name || `R${item.amount || 0} Voucher`, `
    ${field("Voucher name", item.name || "", "name")}
    ${field("Amount", item.amount || 0, "amount", "number")}
    ${field("Description", item.description || "", "description", "textarea", "wide")}
  `, "")).join("") || `<p>No managed vouchers yet. Static voucher amounts remain visible.</p>`;
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

const addItem = (collection) => {
  const defaults = {
    products: { id: uid("product"), brand: "Kalahari", name: "New product", price: 0, stockStatus: "In stock", hidden: false },
    treatments: { id: uid("treatment"), name: "New treatment", price: "", duration: "", hidden: false },
    gallery: { id: uid("gallery"), title: "New result", category: "microneedling", hidden: false },
    vouchers: { id: uid("voucher"), name: "Gift Voucher", amount: 250, hidden: false },
  };
  state.content[collection].unshift(defaults[collection]);
  setDirty();
  render();
};

const updateRecord = (card, key, value) => {
  const collection = card.dataset.collection;
  const recordType = card.dataset.record;
  const id = card.dataset.id;
  const source = collection ? state.content[collection] : state[recordType];
  const item = source.find((entry) => entry.id === id);
  if (!item) return;

  if (key === "price" || key === "amount" || key === "total") item[key] = Number(value) || 0;
  else if (key === "customerText") {
    try { item.customer = JSON.parse(value || "{}"); } catch { item.customer = {}; }
  } else if (key === "productsText") {
    try { item.products = JSON.parse(value || "[]"); } catch { item.products = []; }
  } else item[key] = value;

  if (collection) setDirty();
};

document.addEventListener("input", async (event) => {
  const input = event.target;
  const card = input.closest?.(".editor-card");
  if (!card) return;

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
    return;
  }

  const key = input.dataset.key;
  if (!key) return;
  updateRecord(card, key, input.type === "checkbox" ? input.checked : input.value);
});

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (target.matches("[data-tab]")) {
    if (state.dirty && !confirm("You have unsaved changes. Switch sections anyway?")) return;
    $$(".tabs button").forEach((button) => button.classList.toggle("is-active", button === target));
    $$(".panel").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === target.dataset.tab));
  }

  if (target.matches("[data-add]")) addItem(target.dataset.add);

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
    await request("logout", { method: "POST", body: "{}" });
    location.reload();
  }
});

$("[data-login-form]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("[data-login-status]");
  const formData = new FormData(event.currentTarget);
  status.textContent = "Signing in…";
  status.className = "status";
  try {
    await request("login", {
      method: "POST",
      body: JSON.stringify({
        username: formData.get("username"),
        password: formData.get("password"),
      }),
    });
    $("[data-login-panel]").hidden = true;
    $("[data-admin-portal]").hidden = false;
    await loadAll();
  } catch (error) {
    status.textContent = error.message;
    status.className = "status is-error";
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

request("me")
  .then(async () => {
    $("[data-login-panel]").hidden = true;
    $("[data-admin-portal]").hidden = false;
    await loadAll();
  })
  .catch(() => {
    $("[data-login-panel]").hidden = false;
    $("[data-admin-portal]").hidden = true;
  });
