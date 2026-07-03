const navToggle = document.querySelector("[data-nav-toggle]");
const nav = document.querySelector("[data-nav]");
const bookingForm = document.querySelector("[data-booking-form]");
const appointmentBookingForm = document.querySelector("[data-appointment-booking-form]");
const consultationCartForm = document.querySelector("[data-consultation-cart-form]");
const config = window.LULLUBELLE_CONFIG || {};
const analyticsId = config.googleAnalyticsId || "G-7PG6BZR9QV";

const loadAnalytics = () => {
  if (!analyticsId || window.gtag) {
    return;
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", analyticsId);

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(analyticsId)}`;
  document.head.append(script);
};

window.addEventListener("load", () => {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(loadAnalytics, { timeout: 3000 });
  } else {
    window.setTimeout(loadAnalytics, 1500);
  }
}, { once: true });

const isMissing = (value) => !value;

const trackEvent = (eventName, parameters = {}) => {
  if (typeof window.gtag === "function" && !isMissing(analyticsId)) {
    window.gtag("event", eventName, parameters);
  }
};

const setupBrandFilters = () => {
  const filters = document.querySelectorAll("[data-brand-filter]");
  const panels = document.querySelectorAll("[data-brand-panel]");

  if (!filters.length || !panels.length) {
    return;
  }

  const setActiveBrand = (brand) => {
    filters.forEach((filter) => {
      const isActive = filter.dataset.brandFilter === brand;
      filter.classList.toggle("is-active", isActive);
      filter.setAttribute("aria-pressed", String(isActive));
    });

    panels.forEach((panel) => {
      panel.hidden = panel.dataset.brandPanel !== brand;
    });

    trackEvent("shop_supplier_filter", {
      supplier: brand,
    });
  };

  filters.forEach((filter) => {
    filter.addEventListener("click", () => {
      setActiveBrand(filter.dataset.brandFilter);
    });
  });

  const requestedBrand = new URLSearchParams(window.location.search).get("brand");
  const requestedFilter = requestedBrand
    ? Array.from(filters).find((filter) => filter.dataset.brandFilter.toLowerCase() === requestedBrand.toLowerCase())
    : null;
  if (requestedFilter) {
    setActiveBrand(requestedFilter.dataset.brandFilter);
    document.querySelector("[data-brand-panel]:not([hidden])")?.scrollIntoView({ block: "start" });
  }
};

const setupResultsFilters = () => {
  const filters = document.querySelectorAll("[data-results-filter]");
  const cards = document.querySelectorAll("[data-results-card]");
  const status = document.querySelector("[data-results-status]");

  if (!filters.length || !cards.length) {
    return;
  }

  filters.forEach((filter) => {
    filter.addEventListener("click", () => {
      const category = filter.dataset.resultsFilter;
      let visibleCount = 0;

      filters.forEach((item) => {
        const isActive = item === filter;
        item.classList.toggle("is-active", isActive);
        item.setAttribute("aria-pressed", String(isActive));
      });

      cards.forEach((card) => {
        const categories = (card.dataset.resultsCategories || "").split(" ");
        const isVisible = category === "all" || categories.includes(category);
        card.hidden = !isVisible;
        if (isVisible) visibleCount += 1;
      });

      if (status) {
        const label = category === "all" ? "all results" : `${filter.textContent.trim()} results`;
        status.textContent = `Showing ${visibleCount} ${label}`;
      }
    });
  });
};

const setupVitaDermCatalogue = async () => {
  const grid = document.querySelector("[data-vitaderm-products]");
  if (!grid) return;

  try {
    const response = await fetch("products/vitaderm/catalogue.json");
    if (!response.ok) throw new Error("Catalogue unavailable");
    const products = await response.json();

    grid.innerHTML = products.map((product) => {
      const slug = product.source_url.split("/").filter(Boolean).pop();
      const image = `products/vitaderm/${slug}.webp`;
      const description = product.description.replace(/^Description\s*/i, "");
      const summary = description.length > 180 ? `${description.slice(0, 177).trim()}…` : description;
      return `
        <article class="kalahari-item">
          <div class="product-image-wrap"><img src="${escapeHtml(image)}" alt="VitaDerm ${escapeHtml(product.name)}" width="900" height="900" decoding="async" loading="lazy"></div>
          <h3>${escapeHtml(product.name)}</h3>
          <strong>${formatCurrency(Number(product.price))}</strong>
          ${product.size ? `<small>${escapeHtml(product.size)}</small>` : ""}
          <p>${escapeHtml(summary)}</p>
          <button class="button secondary" type="button" data-vitaderm-cart-add data-product-id="vitaderm-${escapeHtml(slug)}" data-product-name="VitaDerm ${escapeHtml(product.name)}" data-product-price="${Number(product.price)}" data-product-image="${escapeHtml(image)}">Add to cart</button>
        </article>`;
    }).join("");

    grid.querySelectorAll("[data-vitaderm-cart-add]").forEach((button) => {
      button.addEventListener("click", () => {
        addToCart({
          id: button.dataset.productId,
          name: button.dataset.productName,
          price: Number(button.dataset.productPrice) || 0,
          image: button.dataset.productImage,
        });
        button.textContent = "Added";
        window.setTimeout(() => { button.textContent = "Add to cart"; }, 1100);
      });
    });
  } catch {
    grid.innerHTML = "<p>VitaDerm products could not be loaded. Please contact Lullubelle for current availability.</p>";
  }
};

const setupResultLightbox = () => {
  const lightbox = document.querySelector("[data-result-lightbox]");
  const image = lightbox?.querySelector("[data-lightbox-full-image]");
  const title = lightbox?.querySelector("[data-lightbox-title]");
  const closeButton = lightbox?.querySelector("[data-lightbox-close]");
  const triggers = document.querySelectorAll("[data-lightbox-image]");

  if (!lightbox || !image || !triggers.length) {
    return;
  }

  triggers.forEach((trigger) => {
    trigger.addEventListener("click", () => {
      image.src = trigger.dataset.lightboxImage;
      image.alt = trigger.dataset.lightboxAlt || "";
      if (title) title.textContent = trigger.dataset.lightboxTitle || trigger.dataset.lightboxAlt || "Treatment result";
      if (typeof lightbox.showModal === "function") {
        lightbox.showModal();
      } else {
        lightbox.setAttribute("open", "");
      }
    });
  });

  closeButton?.addEventListener("click", () => lightbox.close());
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) {
      lightbox.close();
    }
  });
};

const setupFeaturedProducts = async () => {
  const grid = document.querySelector("[data-featured-products]");
  if (!grid) return;

  try {
    const response = await fetch("products/featured-products.json");
    if (!response.ok) throw new Error("Featured product configuration unavailable");
    const configData = await response.json();
    const perBrand = Number(configData.productsPerBrand) || 2;
    const brandOrder = Array.isArray(configData.brandOrder) ? configData.brandOrder : [];
    const products = Array.isArray(configData.products) ? configData.products : [];
    const selectedByBrand = new Map(brandOrder.map((brand) => [brand, products
      .filter((product) => product.brand === brand && product.available !== false)
      .sort((a, b) => (Number(a.priority) || 99) - (Number(b.priority) || 99))
      .slice(0, perBrand)]));
    const featured = [];
    for (let index = 0; index < perBrand; index += 1) {
      brandOrder.forEach((brand) => {
        const product = selectedByBrand.get(brand)?.[index];
        if (product) featured.push(product);
      });
    }
    if (!featured.length) throw new Error("No featured products available");

    grid.innerHTML = featured.map((product, index) => `
      <article class="featured-product-card">
        <a class="featured-product-image" href="${escapeHtml(product.shopUrl || "shop.html")}" aria-label="View ${escapeHtml(product.brand)} ${escapeHtml(product.name)}">
          <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.brand)} ${escapeHtml(product.name)}" width="650" height="650" decoding="async" loading="${index === 0 ? "eager" : "lazy"}"${index === 0 ? ' fetchpriority="high"' : ""}>
        </a>
        <div>
          <span class="product-brand-badge" data-brand="${escapeHtml(product.brand.toLowerCase())}">${escapeHtml(product.brand)}</span>
          <h3>${escapeHtml(product.name)}</h3>
          <strong>${formatCurrency(Number(product.price))}</strong>
          <div class="featured-product-actions">
            <button class="button secondary" type="button" data-featured-cart-add data-product-id="${escapeHtml(product.id)}" data-product-name="${escapeHtml(product.brand)} ${escapeHtml(product.name)}" data-product-price="${Number(product.price)}" data-product-image="${escapeHtml(product.image)}">Add to Cart</button>
            <a class="text-link" href="${escapeHtml(product.shopUrl || "shop.html")}">View Product</a>
          </div>
        </div>
      </article>`).join("");

    grid.querySelectorAll("[data-featured-cart-add]").forEach((button) => {
      button.addEventListener("click", () => {
        addToCart({ id: button.dataset.productId, name: button.dataset.productName, price: Number(button.dataset.productPrice) || 0, image: button.dataset.productImage });
        button.textContent = "Added";
        window.setTimeout(() => { button.textContent = "Add to Cart"; }, 1100);
      });
    });
  } catch {
    grid.innerHTML = '<p>Featured products are temporarily unavailable. <a class="text-link" href="shop.html">Browse the full shop</a>.</p>';
  }
};

setupBrandFilters();
setupVitaDermCatalogue();
setupFeaturedProducts();
setupResultsFilters();
setupResultLightbox();

const CART_KEY = "lullubelleCart";
const currencyFormatter = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 0,
});

const formatCurrency = (value) => currencyFormatter.format(Number(value) || 0).replace("ZAR", "R").replace(/\s/g, "");

const escapeHtml = (value = "") => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const getCart = () => {
  try {
    const items = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
};

const saveCart = (items) => {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
};

const getCartTotals = (items = getCart()) => items.reduce(
  (total, item) => ({
    quantity: total.quantity + (Number(item.quantity) || 0),
    amount: total.amount + ((Number(item.price) || 0) * (Number(item.quantity) || 0)),
  }),
  { quantity: 0, amount: 0 }
);

const updateCartCount = () => {
  const totals = getCartTotals();
  document.querySelectorAll("[data-cart-count]").forEach((badge) => {
    badge.textContent = String(totals.quantity);
    badge.hidden = totals.quantity === 0;
  });
};

const addToCart = (product) => {
  const items = getCart();
  const existing = items.find((item) => item.id === product.id);

  if (existing) {
    existing.quantity += 1;
  } else {
    items.push({ ...product, quantity: 1 });
  }

  saveCart(items);
  updateCartCount();
  renderCart();
  trackEvent("add_to_cart", {
    item_id: product.id,
    item_name: product.name,
    value: product.price,
    currency: "ZAR",
  });
};

const updateCartItem = (productId, quantity) => {
  const items = getCart()
    .map((item) => item.id === productId ? { ...item, quantity } : item)
    .filter((item) => item.quantity > 0);
  saveCart(items);
  updateCartCount();
  renderCart();
};

const setCartCheckoutState = (items) => {
  const providerLinks = document.querySelectorAll("[data-cart-whatsapp-checkout]");

  providerLinks.forEach((link) => {
    if (!items.length) {
      link.setAttribute("aria-disabled", "true");
      link.disabled = true;
      return;
    }

    link.removeAttribute("aria-disabled");
    link.disabled = false;
  });
};

const getCheckoutCustomer = () => {
  const detailsForm = document.querySelector("[data-checkout-details]");

  if (!detailsForm) {
    return {};
  }

  if (!detailsForm.reportValidity()) {
    return null;
  }

  const formData = new FormData(detailsForm);
  return {
    name: formData.get("name")?.toString().trim() || "",
    email: formData.get("email")?.toString().trim() || "",
    phone: formData.get("phone")?.toString().trim() || "",
  };
};

const startWhatsAppCheckout = () => {
  const status = document.querySelector("[data-cart-status]");
  const items = getCart();
  const totals = getCartTotals(items);
  const customer = getCheckoutCustomer();

  if (!items.length) {
    if (status) {
      status.textContent = "Your cart is empty.";
    }
    return;
  }

  if (!customer) {
    if (status) {
      status.textContent = "Please complete your checkout details first.";
    }
    return;
  }

  const orderLines = items.map((item) => `${item.name} x ${item.quantity} - ${formatCurrency(item.price * item.quantity)}`);
  const message = [
    "Hello Lullubelle, I would like to place this order:",
    "",
    ...orderLines,
    "",
    `Total: ${formatCurrency(totals.amount)}`,
    `Name: ${customer.name}`,
    `Email: ${customer.email}`,
    `Phone: ${customer.phone}`,
  ].join("\n");

  trackEvent("begin_checkout", {
    payment_provider: "whatsapp",
    value: totals.amount,
    currency: "ZAR",
  });
  window.location.href = `https://wa.me/${config.whatsappNumber}?text=${encodeURIComponent(message)}`;
};

const renderCart = () => {
  const container = document.querySelector("[data-cart-items]");
  const emptyState = document.querySelector("[data-cart-empty]");
  const summaryCount = document.querySelector("[data-cart-summary-count]");
  const summaryTotal = document.querySelector("[data-cart-summary-total]");

  if (!container) {
    return;
  }

  const items = getCart();
  const totals = getCartTotals(items);

  container.innerHTML = "";
  emptyState.hidden = items.length > 0;

  items.forEach((item) => {
    const row = document.createElement("article");
    row.className = "cart-item";
    row.innerHTML = `
      <img src="${escapeHtml(item.image || "lullubelle-logo.jpg")}" alt="">
      <div>
        <h3>${escapeHtml(item.name)}</h3>
        <p>${formatCurrency(item.price)} each</p>
        ${item.notes ? `<p class="cart-item-note">${escapeHtml(item.notes)}</p>` : ""}
        <div class="quantity-control" aria-label="Quantity for ${escapeHtml(item.name)}">
          <button type="button" data-cart-qty="${escapeHtml(item.id)}" data-cart-qty-change="-1" aria-label="Decrease quantity">-</button>
          <output>${item.quantity}</output>
          <button type="button" data-cart-qty="${escapeHtml(item.id)}" data-cart-qty-change="1" aria-label="Increase quantity">+</button>
        </div>
      </div>
      <div class="cart-item-total">
        <strong>${formatCurrency(item.price * item.quantity)}</strong>
        <button class="cart-remove" type="button" data-cart-remove="${escapeHtml(item.id)}">Remove</button>
      </div>
    `;
    container.appendChild(row);
  });

  if (summaryCount) {
    summaryCount.textContent = String(totals.quantity);
  }
  if (summaryTotal) {
    summaryTotal.textContent = formatCurrency(totals.amount);
  }

  setCartCheckoutState(items);
};

document.querySelectorAll("[data-cart-add]").forEach((button) => {
  button.addEventListener("click", () => {
    addToCart({
      id: button.dataset.productId,
      name: button.dataset.productName,
      price: Number(button.dataset.productPrice) || 0,
      image: button.dataset.productImage || "lullubelle-logo.jpg",
    });
    button.textContent = "Added";
    window.setTimeout(() => {
      button.textContent = "Add to cart";
    }, 1100);
  });
});

document.querySelector("[data-newsletter-form]")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const email = new FormData(event.currentTarget).get("email")?.toString().trim();
  if (email) {
    window.location.href = `mailto:luzellec4@gmail.com?subject=${encodeURIComponent("Lullubelle Skin Notes signup")}&body=${encodeURIComponent(`Please add ${email} to the Lullubelle Skin Notes list.`)}`;
  }
});

consultationCartForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  const formStatus = consultationCartForm.querySelector("[data-form-status]");
  const formData = new FormData(consultationCartForm);
  const name = formData.get("name")?.toString().trim();
  const date = formData.get("date")?.toString().trim();
  const time = formData.get("time")?.toString().trim();
  const message = formData.get("message")?.toString().trim();
  const notes = [
    `Client: ${name || "Not provided"}`,
    `Preferred date: ${date || "Not provided"}`,
    `Preferred time: ${time || "Not provided"}`,
    `Message: ${message || "No extra notes"}`,
  ].join(" | ");

  addToCart({
    id: `online-skin-consultation-${date || "date"}-${time || "time"}-${Date.now()}`,
    name: "Online skin consultation with Luzelle - 30 minutes",
    price: 800,
    image: "owner-luzelle.jpg",
    notes,
  });

  trackEvent("online_consultation_cart_prepare", {
    preferred_date: date || "not_provided",
    preferred_time: time || "not_provided",
    value: 800,
    currency: "ZAR",
  });
  trackEvent("contact_form_submit", {
    form_name: "online_consultation",
    preferred_date: date || "not_provided",
    preferred_time: time || "not_provided",
    value: 800,
    currency: "ZAR",
  });
  trackEvent("quote_request", {
    request_type: "online_consultation",
    value: 800,
    currency: "ZAR",
  });

  if (formStatus) {
    formStatus.textContent = "Added to cart. Taking you to your order summary...";
  }
  window.location.href = "cart.html";
});

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const quantityButton = target?.closest("[data-cart-qty]");
  const removeButton = target?.closest("[data-cart-remove]");
  const clearButton = target?.closest("[data-cart-clear]");
  const checkoutButton = target?.closest("[data-cart-whatsapp-checkout]");
  const disabledCheckout = target?.closest("[data-cart-whatsapp-checkout][aria-disabled='true']");

  if (disabledCheckout) {
    event.preventDefault();
    return;
  }

  if (checkoutButton) {
    startWhatsAppCheckout();
  }

  if (quantityButton) {
    const items = getCart();
    const item = items.find((cartItem) => cartItem.id === quantityButton.dataset.cartQty);
    if (item) {
      updateCartItem(item.id, item.quantity + Number(quantityButton.dataset.cartQtyChange));
    }
  }

  if (removeButton) {
    updateCartItem(removeButton.dataset.cartRemove, 0);
  }

  if (clearButton) {
    saveCart([]);
    updateCartCount();
    renderCart();
  }
});

updateCartCount();
renderCart();

navToggle?.addEventListener("click", () => {
  const isOpen = nav?.classList.toggle("is-open") ?? false;
  navToggle.setAttribute("aria-expanded", String(isOpen));
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !nav?.classList.contains("is-open")) {
    return;
  }

  nav.classList.remove("is-open");
  navToggle?.setAttribute("aria-expanded", "false");
  navToggle?.focus();
});

nav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    nav.classList.remove("is-open");
    navToggle?.setAttribute("aria-expanded", "false");
  });
});

document.querySelectorAll("[data-track-event]").forEach((element) => {
  element.addEventListener("click", () => {
    trackEvent(element.dataset.trackEvent, {
      link_text: element.textContent?.trim() || "",
      link_url: element.href || "",
      product_id: element.dataset.productId || "",
      payment_provider: element.dataset.paymentProvider || "",
    });
  });
});

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest("a[href]");

  if (!link) {
    return;
  }

  const href = link.getAttribute("href") || "";
  const parameters = {
    link_text: link.textContent?.trim() || link.getAttribute("aria-label") || "",
    link_url: link.href || href,
    page_path: window.location.pathname,
  };

  if (href.startsWith("tel:")) {
    trackEvent("phone_click", parameters);
    return;
  }

  if (href.startsWith("mailto:")) {
    trackEvent("email_click", parameters);
    return;
  }

  if (href.includes("wa.me/")) {
    trackEvent("whatsapp_click", parameters);

    let enquiryText = "";
    try {
      enquiryText = new URL(link.href).searchParams.get("text") || "";
    } catch {
      enquiryText = href;
    }

    if (/product|stock|Kalahari|VitaDerm|Mesoestetic|nail|lash|body care/i.test(enquiryText)) {
      trackEvent("product_enquiry", {
        ...parameters,
        enquiry_text: enquiryText.slice(0, 120),
      });
    }
  }
});

bookingForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  const formStatus = bookingForm.querySelector("[data-form-status]");
  const formData = new FormData(bookingForm);
  const name = formData.get("name")?.toString().trim();
  const treatment = formData.get("treatment")?.toString().trim();
  const date = formData.get("date")?.toString().trim();
  const time = formData.get("time")?.toString().trim();
  const message = formData.get("message")?.toString().trim();
  const whatsappNumber = config.whatsappNumber || "";

  const whatsappMessage = [
    "Hello Lullubelle, I would like to request an appointment.",
    "",
    `Name: ${name || "Not provided"}`,
    `Treatment: ${treatment || "Not provided"}`,
    `Preferred date: ${date || "Not provided"}`,
    `Preferred time: ${time || "Not provided"}`,
    "",
    `Message: ${message || "No extra notes"}`,
  ].join("\n");

  trackEvent("appointment_whatsapp_prepare", {
    treatment: treatment || "not_provided",
    preferred_date: date || "not_provided",
    preferred_time: time || "not_provided",
  });
  trackEvent("contact_form_submit", {
    form_name: "appointment_request",
    treatment: treatment || "not_provided",
    preferred_date: date || "not_provided",
    preferred_time: time || "not_provided",
  });
  trackEvent("quote_request", {
    request_type: "treatment_appointment",
    treatment: treatment || "not_provided",
  });

  if (isMissing(whatsappNumber)) {
    if (formStatus) {
      formStatus.textContent = "WhatsApp booking is temporarily unavailable. Please call or email Lullubelle.";
    }
    return;
  }

  if (formStatus) {
    formStatus.textContent = "";
  }
  window.location.href = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(whatsappMessage)}`;
});

appointmentBookingForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  const status = appointmentBookingForm.querySelector("[data-appointment-status]");
  const fields = {
    name: appointmentBookingForm.elements.name,
    mobile: appointmentBookingForm.elements.mobile,
    email: appointmentBookingForm.elements.email,
    service: appointmentBookingForm.elements.service,
    date: appointmentBookingForm.elements.date,
    time: appointmentBookingForm.elements.time,
    notes: appointmentBookingForm.elements.notes,
  };
  const messages = {
    name: "Please enter your full name.",
    mobile: "Please enter a valid mobile number.",
    email: "Please enter a valid email address.",
    service: "Please choose a service or treatment.",
    date: "Please choose your preferred date.",
    time: "Please choose your preferred time.",
    notes: "Please add your notes or enter “None”.",
  };

  let firstInvalid = null;
  Object.entries(fields).forEach(([name, field]) => {
    const error = appointmentBookingForm.querySelector(`[data-error-for="${name}"]`);
    const valid = field.checkValidity();
    field.setAttribute("aria-invalid", String(!valid));
    if (error) {
      error.textContent = valid ? "" : messages[name];
    }
    if (!valid && !firstInvalid) {
      firstInvalid = field;
    }
  });

  if (firstInvalid) {
    if (status) {
      status.classList.remove("is-success");
      status.textContent = "Please correct the highlighted fields before continuing.";
    }
    firstInvalid.focus();
    return;
  }

  const formData = new FormData(appointmentBookingForm);
  const whatsappNumber = config.whatsappNumber || "27825764219";
  const whatsappMessage = [
    "Hi Lullubelle, I would like to book an appointment.",
    "",
    `Name: ${formData.get("name")}`,
    `Mobile: ${formData.get("mobile")}`,
    `Email: ${formData.get("email")}`,
    `Service: ${formData.get("service")}`,
    `Preferred date: ${formData.get("date")}`,
    `Preferred time: ${formData.get("time")}`,
    `First-time client: ${formData.get("firstTime") || "Not specified"}`,
    `Preferred contact method: ${formData.get("contactMethod") || "Not specified"}`,
    `Notes: ${formData.get("notes")}`,
    "",
    "Please confirm availability.",
  ].join("\n");

  trackEvent("appointment_whatsapp_prepare", {
    treatment: formData.get("service"),
    preferred_date: formData.get("date"),
    preferred_time: formData.get("time"),
  });

  if (status) {
    status.classList.add("is-success");
    status.textContent = "Your booking request has been prepared in WhatsApp. Please press send to complete your request.";
  }
  window.open(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(whatsappMessage)}`, "_blank", "noopener");
});

if (appointmentBookingForm) {
  const dateField = appointmentBookingForm.elements.date;
  if (dateField) {
    const today = new Date();
    const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().split("T")[0];
    dateField.min = localDate;
  }

  appointmentBookingForm.addEventListener("input", (event) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) || !field.name) {
      return;
    }
    const error = appointmentBookingForm.querySelector(`[data-error-for="${field.name}"]`);
    if (field.checkValidity()) {
      field.removeAttribute("aria-invalid");
      if (error) {
        error.textContent = "";
      }
    }
  });
}
