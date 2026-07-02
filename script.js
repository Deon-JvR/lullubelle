const navToggle = document.querySelector("[data-nav-toggle]");
const nav = document.querySelector("[data-nav]");
const bookingForm = document.querySelector("[data-booking-form]");
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
  if (requestedBrand && Array.from(filters).some((filter) => filter.dataset.brandFilter === requestedBrand)) {
    setActiveBrand(requestedBrand);
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

setupBrandFilters();
setupResultsFilters();

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

    if (/product|stock|kalahari|vitaderm|mesoestetic|nail|lash|body care/i.test(enquiryText)) {
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
