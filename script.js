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
    ? Array.from(filters).find((filter) => filter.dataset.brandFilter.toLowerCase() === requestedBrand.toLowerCase() || filter.textContent.trim().toLowerCase() === requestedBrand.toLowerCase())
    : null;
  if (requestedFilter) {
    setActiveBrand(requestedFilter.dataset.brandFilter);
    document.querySelector("[data-brand-panel]:not([hidden])")?.scrollIntoView({ block: "start" });
  }
};

const setupResultsFilters = () => {
  const filters = document.querySelectorAll("[data-results-filter]");
  const cards = Array.from(document.querySelectorAll("[data-results-card]")).filter((card) => {
    const images = Array.from(card.querySelectorAll("img"));
    const hasGenuineImages = images.length > 0 && images.every((image) => {
      const source = image.getAttribute("src")?.trim();
      const alt = image.getAttribute("alt")?.trim() || "";
      return Boolean(source) && !/^placeholder\b/i.test(alt);
    });
    if (!hasGenuineImages) card.remove();
    return hasGenuineImages;
  });
  const status = document.querySelector("[data-results-status]");

  if (!filters.length || !cards.length) {
    return;
  }

  filters.forEach((filter) => {
    const category = filter.dataset.resultsFilter;
    filter.hidden = category !== "all" && !cards.some((card) => (card.dataset.resultsCategories || "").split(" ").includes(category));
  });

  if (status) status.textContent = `Showing ${cards.length} all results`;

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

const appendStructuredData = (key, data) => {
  if (document.querySelector(`script[data-generated-schema="${key}"]`)) return;
  const node = document.createElement("script");
  node.type = "application/ld+json";
  node.dataset.generatedSchema = key;
  node.textContent = JSON.stringify(data);
  document.head.appendChild(node);
};

const syncProductSchemas = (scope = document) => {
  const buttons = Array.from(scope.querySelectorAll("[data-managed-cart-add], [data-product-detail-cart]"));
  const hasStaticProductSchema = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    .some((node) => !node.dataset.productSchema && node.textContent.includes('"@type": "Product"'));
  if (hasStaticProductSchema && buttons.length === 1) return;

  buttons.forEach((button) => {
    const id = button.dataset.productId;
    if (!id || document.querySelector(`script[data-product-schema="${id}"]`)) return;
    const card = button.closest("article") || button.parentElement;
    const image = button.dataset.productImage || card?.querySelector("img")?.getAttribute("src") || "lullubelle-logo.jpg";
    const description = card?.querySelector("p")?.textContent?.trim() || `${button.dataset.productName} available from Lullubelle Beauty Specialist.`;
    const brand = (button.dataset.productName || "").split(" ")[0] || "Lullubelle";
    const node = document.createElement("script");
    node.type = "application/ld+json";
    node.dataset.productSchema = id;
    node.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: button.dataset.productName,
      description,
      image: new URL(image, window.location.href).href,
      sku: id,
      brand: { "@type": "Brand", name: brand },
      offers: {
        "@type": "Offer",
        url: `${window.location.origin}${productDetailUrl(id)}`,
        priceCurrency: "ZAR",
        price: Number(button.dataset.productPrice) || 0,
        availability: "https://schema.org/InStock",
        itemCondition: "https://schema.org/NewCondition",
      },
    });
    document.head.appendChild(node);
  });
};

const setupPageStructuredData = () => {
  const path = window.location.pathname;
  if (path !== "/" && path !== "/index.html") {
    const heading = document.querySelector("h1")?.textContent?.trim() || document.title.split("|")[0].trim();
    appendStructuredData("breadcrumb", {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${window.location.origin}/` },
        { "@type": "ListItem", position: 2, name: heading, item: window.location.href.split("#")[0].split("?")[0] },
      ],
    });
  }

  const hasFaqSchema = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).some((node) => node.textContent.includes('"FAQPage"'));
  if (!hasFaqSchema) {
    const questions = Array.from(document.querySelectorAll(".faq-list details")).map((detail) => ({
      "@type": "Question",
      name: detail.querySelector("summary")?.textContent?.trim(),
      acceptedAnswer: { "@type": "Answer", text: detail.querySelector("p")?.textContent?.trim() },
    })).filter((item) => item.name && item.acceptedAnswer.text);
    if (questions.length) appendStructuredData("faq", { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: questions });
  }

  syncProductSchemas();
};

const setupShopCatalogue = (content) => {
  const products = getVisibleManagedItems(content?.products).map(normaliseManagedProduct);
  const brands = (Array.isArray(content?.brands) ? content.brands : [])
    .filter((brand) => brand?.active !== false)
    .sort((a, b) => Number(a.order) - Number(b.order) || a.name.localeCompare(b.name))
    .filter((brand) => {
      const hasProducts = products.some((product) => (product.brandId && product.brandId === brand.id) || product.brand.toLowerCase() === brand.name.toLowerCase());
      return hasProducts || brand.hideWhenEmpty === false;
    });
  const tabs = document.querySelector(".supplier-tabs");
  const payments = document.querySelector(".payments-section");
  if (!tabs || !payments || !brands.length) return;

  tabs.innerHTML = brands.map((brand, index) => `<button class="supplier-tab ${index === 0 ? "is-active" : ""}" type="button" data-brand-filter="${escapeHtml(brand.id)}" aria-pressed="${index === 0 ? "true" : "false"}">${escapeHtml(brand.name)}</button>`).join("");
  document.querySelectorAll("[data-brand-panel]").forEach((panel) => panel.remove());
  payments.insertAdjacentHTML("beforebegin", brands.map((brand, index) => {
    const brandProducts = products.filter((product) => (product.brandId && product.brandId === brand.id) || product.brand.toLowerCase() === brand.name.toLowerCase());
    return `<section class="section product-price-section" data-brand-panel="${escapeHtml(brand.id)}" ${index === 0 ? "" : "hidden"}>
      <div class="section-heading"><p class="eyebrow">${escapeHtml(brand.name)}</p><h2>${escapeHtml(brand.name)} products</h2><p>Browse ${escapeHtml(brand.name)} products available through Lullubelle.</p></div>
      <div class="kalahari-grid" aria-live="polite">${brandProducts.length ? brandProducts.map(renderManagedProductCard).join("") : `<p>No ${escapeHtml(brand.name)} products are currently listed.</p>`}</div>
      <div class="stock-note"><p>Product availability can change. Lullubelle will confirm stock before completing your order.</p></div>
    </section>`;
  }).join(""));
  document.querySelectorAll("[data-brand-panel] .kalahari-grid").forEach((grid) => {
    bindProductButtons(grid);
    syncProductSchemas(grid);
  });
  setupBrandFilters();
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

const setupFeaturedProducts = (content) => {
  const grid = document.querySelector("[data-featured-products]");
  if (!grid) return;

  const products = getVisibleManagedItems(content?.products).map(normaliseManagedProduct);
  const featured = selectFeaturedProducts(products, content?.brands);

  if (!featured.length) {
    grid.innerHTML = '<p>Featured products are temporarily unavailable. <a class="text-link" href="shop.html">Browse the full shop</a>.</p>';
    return;
  }

  grid.innerHTML = featured.slice(0, 8).map((product) => `
    <article class="featured-product-card home-product-card">
      <a class="featured-product-image" href="${escapeHtml(productDetailUrl(product.id))}" aria-label="View ${escapeHtml(product.brand)} ${escapeHtml(product.name)}">
        ${product.bestSeller ? '<span class="product-status-badge">Best Seller</span>' : product.featured ? '<span class="product-status-badge">Featured</span>' : ""}
        <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.brand)} ${escapeHtml(product.name)}" width="650" height="650" decoding="async" loading="lazy">
      </a>
      <div>
        <span class="product-brand-badge" data-brand="${escapeHtml(product.brand.toLowerCase())}">${escapeHtml(product.brand)}</span>
        <h3>${escapeHtml(product.name)}</h3>
        <strong>${formatCurrency(product.price)}</strong>
        <p class="product-description">${escapeHtml(product.benefit)}</p>
        <div class="featured-product-actions">
          <button class="button secondary" type="button" data-managed-cart-add data-product-id="${escapeHtml(product.id)}" data-product-name="${escapeHtml(product.brand)} ${escapeHtml(product.name)}" data-product-price="${Number(product.price)}" data-product-image="${escapeHtml(product.image)}"${isPurchasable(product) ? "" : " disabled"}>${isPurchasable(product) ? "Add to Cart" : escapeHtml(stockLabel(product.stockStatus))}</button>
          <a class="text-link" href="${escapeHtml(productDetailUrl(product.id))}">View Product</a>
        </div>
      </div>
    </article>`).join("");

  bindProductButtons(grid);
  syncProductSchemas(grid);

  const previousButton = document.querySelector("[data-featured-carousel-prev]");
  const nextButton = document.querySelector("[data-featured-carousel-next]");
  const updateControls = () => {
    const atStart = grid.scrollLeft <= 2;
    const atEnd = grid.scrollLeft + grid.clientWidth >= grid.scrollWidth - 2;
    if (previousButton) previousButton.disabled = atStart;
    if (nextButton) nextButton.disabled = atEnd;
  };
  const moveCarousel = (direction) => {
    const card = grid.querySelector(".featured-product-card");
    if (!card) return;
    const gap = Number.parseFloat(getComputedStyle(grid).columnGap) || 0;
    grid.scrollBy({ left: direction * (card.getBoundingClientRect().width + gap), behavior: "smooth" });
  };
  previousButton?.addEventListener("click", () => moveCarousel(-1));
  nextButton?.addEventListener("click", () => moveCarousel(1));
  grid.addEventListener("scroll", updateControls, { passive: true });
  window.addEventListener("resize", updateControls);
  updateControls();
};

const CART_KEY = "lullubelleCart";
const PROMO_KEY = "lullubellePromoCode";
const IKHOKHA_CHECKOUT_ENDPOINT = "/.netlify/functions/ikhokha-checkout";
const PUDO_DELIVERY_FEE = 80;
let appliedPromo = { code: localStorage.getItem(PROMO_KEY) || "", discountAmount: 0, deliveryFee: null, total: null };
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

let managedContentPromise;

const loadStaticContent = async () => {
  const readItems = async (name) => {
    try {
      const response = await fetch(`/data/${name}.json`, { headers: { Accept: "application/json" } });
      if (!response.ok) return [];
      const items = await response.json();
      return Array.isArray(items) ? items : [];
    } catch {
      return [];
    }
  };
  const [brands, products, treatments, gallery, vouchers] = await Promise.all(
    ["brands", "products", "treatments", "gallery", "vouchers"].map(readItems),
  );
  return { brands, products, treatments, gallery, vouchers };
};

const loadManagedContent = async () => {
  if (!managedContentPromise) {
    managedContentPromise = fetch("/.netlify/functions/admin-content", { headers: { Accept: "application/json" } })
      .then((response) => response.ok ? response.json() : null)
      .then(async (content) => {
        const fallback = await loadStaticContent();
        if (hasCompleteProductCatalogue(content?.products, fallback.products)) return content;
        return {
          products: fallback.products,
          brands: content?.brands?.length ? content.brands : fallback.brands,
          treatments: content?.treatments || [],
          gallery: content?.gallery?.length ? content.gallery : fallback.gallery,
          vouchers: content?.vouchers || [],
          updatedAt: content?.updatedAt || new Date().toISOString(),
        };
      })
      .catch(async () => {
        const fallback = await loadStaticContent();
        return {
          ...fallback,
          updatedAt: new Date().toISOString(),
        };
      });
  }
  return managedContentPromise;
};

const getVisibleManagedItems = (items) => Array.isArray(items)
  ? items.filter((item) => item && item.hidden !== true)
  : [];

const hasCompleteProductCatalogue = (items, fallbackItems = []) => {
  if (!Array.isArray(items) || !items.length) return false;
  const brands = new Set(items.map((product) => product?.brand).filter(Boolean));
  const ids = new Set(items.map((product) => product?.id).filter(Boolean));
  return items.length >= fallbackItems.length
    && fallbackItems.every((product) => ids.has(product.id))
    && ["Kalahari", "VitaDerm", "Mesoestetic"].every((brand) => brands.has(brand));
};

const slugify = (value = "item") => String(value)
  .toLowerCase()
  .replace(/&/g, "and")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "") || "item";

const normaliseManagedProduct = (product) => {
  const brand = product.brand || "Lullubelle";
  const name = product.name || "Product";
  return {
    id: product.id || `${slugify(brand)}-${slugify(name)}`,
    brandId: product.brandId || slugify(brand),
    brand,
    name,
    price: Number(product.price) || 0,
    image: product.image || "lullubelle-logo.jpg",
    benefit: product.benefit || product.description || "Professional home care selected by Lullubelle.",
    description: product.description || product.benefit || "Professional skincare available from Lullubelle Beauty Specialist.",
    directions: product.directions || "Use as directed by your skin therapist.",
    ingredients: product.ingredients || "Please confirm current ingredients with Lullubelle before purchase.",
    suitable: product.suitable || "Selected skin routines after consultation.",
    size: product.size || "",
    sku: product.sku || product.id || `${slugify(brand)}-${slugify(name)}`,
    stockStatus: product.stockStatus || "In stock",
    featured: product.featured === true,
    bestSeller: product.bestSeller === true,
    category: product.category || "",
    benefits: Array.isArray(product.benefits) ? product.benefits : [],
    storage: Array.isArray(product.storage) ? product.storage : [],
    imageAlt: product.imageAlt || `${brand} ${name}`,
    seoTitle: product.seoTitle || "",
    seoDescription: product.seoDescription || product.metaDescription || "",
  };
};

const stockLabel = (status = "In stock") => {
  if (/out/i.test(status)) return "Out of stock";
  if (/coming/i.test(status)) return "Coming soon";
  return "In stock";
};

const isPurchasable = (product) => stockLabel(product.stockStatus) === "In stock";

const bindProductButtons = (scope = document) => {
  scope.querySelectorAll("[data-managed-cart-add]").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => {
      addToCart({
        id: button.dataset.productId,
        name: button.dataset.productName,
        price: Number(button.dataset.productPrice) || 0,
        image: button.dataset.productImage || "lullubelle-logo.jpg",
      });
      button.textContent = "Added";
      window.setTimeout(() => { button.textContent = "Add to cart"; }, 1100);
    });
  });
};

const renderManagedProductCard = (product) => {
  const disabled = isPurchasable(product) ? "" : " disabled";
  const label = isPurchasable(product) ? "Add to cart" : stockLabel(product.stockStatus);
  const badge = product.bestSeller ? "Best Seller" : product.featured ? "Featured" : "";
  return `
    <article class="kalahari-item">
      ${badge ? `<span class="product-status-badge">${escapeHtml(badge)}</span>` : ""}
      <div class="product-image-wrap"><img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.imageAlt)}" width="650" height="650" decoding="async" loading="lazy"></div>
      <span class="product-brand-badge" data-brand="${escapeHtml(product.brand.toLowerCase())}">${escapeHtml(product.brand)}</span>
      <h3>${escapeHtml(product.name)}</h3>
      <strong>${formatCurrency(product.price)}</strong>
      <p>${escapeHtml(product.benefit)}</p>
      <span class="product-stock"><span aria-hidden="true"></span> ${escapeHtml(stockLabel(product.stockStatus))}</span>
      <div class="product-card-actions">
        <button class="button secondary" type="button" data-managed-cart-add data-product-id="${escapeHtml(product.id)}" data-product-name="${escapeHtml(product.brand)} ${escapeHtml(product.name)}" data-product-price="${Number(product.price)}" data-product-image="${escapeHtml(product.image)}"${disabled}>${escapeHtml(label)}</button>
        <a class="text-link" href="${escapeHtml(productDetailUrl(product.id))}">View Product</a>
      </div>
    </article>`;
};

const applyManagedVouchers = (vouchers = []) => {
  const visible = getVisibleManagedItems(vouchers);
  const grid = document.querySelector(".voucher-grid");
  if (!grid || !visible.length) return;

  grid.innerHTML = visible.map((voucher) => {
    const amount = Number(voucher.amount) || Number(String(voucher.name || "").replace(/\D/g, "")) || 0;
    const name = voucher.name || `R${amount}`;
    return `
      <article class="voucher-card">
        <span>Gift Voucher</span>
        <h2>${escapeHtml(name)}</h2>
        <p>${escapeHtml(voucher.description || "Flexible Lullubelle beauty credit for treatments or skincare products.")}</p>
        <div class="product-buy-actions">
          <button class="button primary" type="button" data-managed-cart-add data-product-id="${escapeHtml(voucher.id || `gift-voucher-${amount}`)}" data-product-name="Lullubelle Gift Voucher ${escapeHtml(name)}" data-product-price="${amount}" data-product-image="lullubelle-logo.jpg">Add to cart</button>
          <a class="button secondary" href="cart">View cart</a>
        </div>
      </article>`;
  }).join("");
  bindProductButtons(grid);
};

const applyManagedGallery = (gallery = []) => {
  const visible = getVisibleManagedItems(gallery).filter((item) => item.image && !/lullubelle-logo|placeholder|data:image/i.test(item.image));
  const grid = document.querySelector(".results-gallery-section .results-grid");
  if (!grid || !visible.length) return;

  grid.innerHTML = visible.map((item) => {
    const title = item.title || "Lullubelle treatment result";
    const category = item.category || "skin-results";
    const categories = item.categories || slugify(category);
    const description = item.description || "Real Lullubelle treatment progress.";
    return `
      <article class="result-card" data-results-card data-results-categories="${escapeHtml(categories)}">
        <div class="result-feature-media">
          <button class="result-lightbox-trigger" type="button" data-lightbox-image="${escapeHtml(item.image || "lullubelle-logo.jpg")}" data-lightbox-alt="${escapeHtml(title)}" data-lightbox-title="${escapeHtml(title)}" aria-label="Enlarge ${escapeHtml(title)}">
            <img src="${escapeHtml(item.image || "lullubelle-logo.jpg")}" alt="${escapeHtml(title)}" width="1200" height="1200" loading="lazy" decoding="async">
          </button>
          ${item.featured ? '<span class="result-badge">Featured result</span>' : ""}
        </div>
        <div class="result-card-content">
          <p class="eyebrow">${escapeHtml(category)}</p>
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(description)}</p>
          ${item.treatments ? `<p><strong>${escapeHtml(item.treatments)}</strong></p>` : ""}
          <a class="button primary" href="/book-appointment">Book Appointment</a>
        </div>
      </article>`;
  }).join("");
};

const applyHomepageGallery = (gallery = []) => {
  const grid = document.querySelector(".home-results-grid");
  if (!grid) return;
  const featured = getVisibleManagedItems(gallery)
    .filter((item) => item.featured && item.image && !/lullubelle-logo|placeholder|data:image/i.test(item.image))
    .slice(0, 3);
  if (!featured.length) {
    grid.innerHTML = "<p>Before &amp; After results are temporarily unavailable.</p>";
    return;
  }
  grid.innerHTML = featured.map((item) => `
    <a class="result-card home-result-card" href="/before-after/">
      <div class="home-result-image"><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title || "Before and after treatment result")}" width="1200" height="750" loading="lazy" decoding="async"></div>
      <div class="result-card-content">
        <p class="eyebrow">${escapeHtml(item.category || "Treatment result")}</p>
        <h3>${escapeHtml(item.title || "Before & After")}</h3>
      </div>
    </a>`).join("");
};

const applyManagedTreatments = (treatments = []) => {
  const visible = getVisibleManagedItems(treatments);
  if (!visible.length) return;

  const menuGrid = document.querySelector(".treatment-menu-grid");
  if (menuGrid) {
    const grouped = visible.reduce((groups, treatment) => {
      const category = treatment.category || "Treatments";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(treatment);
      return groups;
    }, new Map());
    menuGrid.innerHTML = Array.from(grouped.entries()).map(([category, items]) => `
      <article class="treatment-menu-card">
        <h2 class="treatment-heading">${escapeHtml(category)}</h2>
        <ul class="treatment-list simple-list">
          ${items.map((treatment) => `
            <li>
              <span>${escapeHtml(treatment.name || "Treatment")}${treatment.duration ? ` <small>${escapeHtml(treatment.duration)}</small>` : ""}${treatment.description ? `<small>${escapeHtml(treatment.description)}</small>` : ""}</span>
              <b>${escapeHtml(treatment.price || "Confirm")}</b>
            </li>`).join("")}
        </ul>
      </article>`).join("");
  }

  const menu = document.querySelector(".treatment-menu-section");
  if (!menu || document.querySelector("[data-managed-treatments]")) return;

  const featured = visible.filter((treatment) => treatment.featured).slice(0, 8);
  if (!featured.length) return;
  const section = document.createElement("section");
  section.className = "section treatment-discovery-section";
  section.dataset.managedTreatments = "true";
  section.innerHTML = `
    <div class="section-heading">
      <p class="eyebrow">Current treatment menu</p>
      <h2>Featured Lullubelle treatments</h2>
      <p>These treatment details are managed from the Lullubelle Admin Portal.</p>
    </div>
    <div class="treatment-feature-grid">
      ${featured.map((treatment) => `
        <article class="treatment-feature-card">
          <span aria-hidden="true">★</span>
          <h3>${escapeHtml(treatment.name || "Treatment")}</h3>
          <p>${escapeHtml(treatment.description || "Treatment available by appointment.")}</p>
          <p><strong>${escapeHtml(treatment.price || "Confirm price")}</strong>${treatment.duration ? ` · ${escapeHtml(treatment.duration)}` : ""}</p>
        </article>`).join("")}
    </div>`;
  menu.after(section);
};

const applyManagedContent = (content) => {
  if (!content) return;
  setupShopCatalogue(content);
  setupFeaturedProducts(content);
  applyManagedVouchers(content.vouchers);
  applyManagedGallery(content.gallery);
  applyHomepageGallery(content.gallery);
  applyManagedTreatments(content.treatments);
};

const sendAdminRecord = (endpoint, payload) => {
  const body = JSON.stringify(payload);
  if (navigator.sendBeacon) {
    navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
    return;
  }
  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
};

const selectFeaturedProducts = (products, brands = []) => {
  const featured = products.filter((product) => product.featured || product.bestSeller);
  const brandOrder = [...brands].sort((a, b) => Number(a.order) - Number(b.order)).map((brand) => brand.id);
  const selected = brandOrder.flatMap((brandId) => featured.filter((product) => product.brandId === brandId).slice(0, 2));
  const selectedIds = new Set(selected.map((product) => product.id));
  return [...selected, ...featured.filter((product) => !selectedIds.has(product.id))].slice(0, 8);
};
const productDetailUrl = (id) => `/products/${encodeURIComponent(id)}`;

const getAllShopProducts = async () => {
  const managedContent = await loadManagedContent();
  return getVisibleManagedItems(managedContent?.products).map(normaliseManagedProduct);
};

const renderProductDetailPage = async () => {
  const container = document.querySelector("[data-product-detail]");
  if (!container) return;

  const products = await getAllShopProducts();
  if (!products.length) {
    container.innerHTML = `
      <section class="section product-detail product-detail-page-hero">
        <div class="product-detail-copy">
          <p class="eyebrow">Product catalogue</p>
          <h1>Products are temporarily unavailable</h1>
          <p class="lead">The shared website catalogue could not be loaded. Please try again shortly or contact Lullubelle for product assistance.</p>
          <a class="button primary" href="shop">Back to Shop</a>
        </div>
      </section>`;
    return;
  }

  const requestedId = new URLSearchParams(window.location.search).get("product")
    || window.location.pathname.match(/^\/products\/([^/]+)\/?$/)?.[1];
  const product = products.find((item) => item.id === requestedId) || products[0];
  const related = products
    .filter((item) => item.id !== product.id && item.brand === product.brand)
    .slice(0, 3);
  const description = product.description || product.benefit || `${product.brand} ${product.name} is available through Lullubelle Beauty Specialist in Centurion.`;

  document.title = product.seoTitle || `${product.brand} ${product.name} | Lullubelle Skincare Centurion`;
  document.querySelector('meta[name="description"]')?.setAttribute("content", product.seoDescription || `${product.brand} ${product.name} from Lullubelle Beauty Specialist in Centurion. View benefits, directions, skin suitability and order online.`);
  document.querySelector('link[rel="canonical"]')?.setAttribute("href", `https://www.lullubelle.co.za${productDetailUrl(product.id)}`);

  container.innerHTML = `
    <section class="section product-detail product-detail-page-hero">
      <div class="product-detail-media">
        <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.imageAlt)}" width="900" height="900" decoding="async" loading="eager" fetchpriority="high">
      </div>
      <div class="product-detail-copy">
        <p class="eyebrow">${escapeHtml(product.brand)} skincare</p>
        <h1>${escapeHtml(product.name)}</h1>
        <strong>${formatCurrency(product.price)}</strong>
        ${product.size ? `<p class="product-size">${escapeHtml(product.size)}</p>` : ""}
        <p class="lead">${escapeHtml(product.benefit || description)}</p>
        <div class="product-buy-actions">
          <button class="button primary" type="button" data-product-detail-cart data-product-id="${escapeHtml(product.id)}" data-product-name="${escapeHtml(product.brand)} ${escapeHtml(product.name)}" data-product-price="${Number(product.price)}" data-product-image="${escapeHtml(product.image)}">Add to Cart</button>
          <a class="button secondary" href="shop?brand=${encodeURIComponent(product.brandId)}">Back to ${escapeHtml(product.brand)}</a>
        </div>
      </div>
    </section>
    <section class="section product-detail-info">
      <div class="treatment-info-grid">
        <article>
          <p class="eyebrow">Description</p>
          <h2>Professional home-care support</h2>
          <p>${escapeHtml(description)}</p>
        </article>
        <article>
          <p class="eyebrow">Benefits</p>
          <h2>Why clients choose it</h2>
          ${product.benefits.length ? `<ul class="simple-list">${product.benefits.map((benefit) => `<li>${escapeHtml(benefit)}</li>`).join("")}</ul>` : `<p>${escapeHtml(product.benefit || description)}</p>`}
        </article>
        <article>
          <p class="eyebrow">Directions</p>
          <h2>How to use</h2>
          <p>${escapeHtml(product.directions || "Use as directed by your skin therapist.")}</p>
        </article>
        <article>
          <p class="eyebrow">Suitable skin type</p>
          <h2>Best suited for</h2>
          <p>${escapeHtml(product.suitable || "Selected skin routines after consultation.")}</p>
        </article>
      </div>
      ${product.storage.length ? `<div class="stock-note"><h2>Storage</h2><ul class="simple-list">${product.storage.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
      <details class="ingredients-disclosure">
        <summary>Ingredients</summary>
        <p>${escapeHtml(product.ingredients || "Please confirm current ingredients with Lullubelle before purchase.")}</p>
      </details>
    </section>
    <section class="section related-products-section" aria-labelledby="related-products-heading">
      <div class="section-heading">
        <p class="eyebrow">Related products</p>
        <h2 id="related-products-heading">Complete your routine</h2>
      </div>
      <div class="kalahari-grid">
        ${related.map((item) => `
          <article class="kalahari-item">
            <div class="product-image-wrap"><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.brand)} ${escapeHtml(item.name)}" width="650" height="650" decoding="async" loading="lazy"></div>
            <span class="product-brand-badge" data-brand="${escapeHtml(item.brand.toLowerCase())}">${escapeHtml(item.brand)}</span>
            <h3>${escapeHtml(item.name)}</h3>
            <strong>${formatCurrency(item.price)}</strong>
            <p>${escapeHtml(item.benefit || "Professional home care selected by Lullubelle.")}</p>
            <div class="product-card-actions"><a class="button secondary" href="${escapeHtml(productDetailUrl(item.id))}">View Product</a></div>
          </article>`).join("")}
      </div>
    </section>
    <section class="section faq-section">
      <div class="section-heading"><p class="eyebrow">Product FAQ</p><h2>Before you order</h2></div>
      <div class="faq-list">
        <details><summary>Is this product in stock?</summary><p>Products are marked as available online, but Lullubelle confirms final stock before completing your order.</p></details>
        <details><summary>Can I get help choosing products?</summary><p>Yes. Book a skin consultation or contact Lullubelle for personalised home-care guidance.</p></details>
        <details><summary>Are ingredients always current?</summary><p>Brands may update formulations. Please confirm the latest ingredient list before purchase if you have sensitivities or allergies.</p></details>
      </div>
    </section>`;

  container.querySelector("[data-product-detail-cart]")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    addToCart({
      id: button.dataset.productId,
      name: button.dataset.productName,
      price: Number(button.dataset.productPrice) || 0,
      image: button.dataset.productImage,
    });
    button.textContent = "Added";
    window.setTimeout(() => { button.textContent = "Add to Cart"; }, 1100);
  });

  appendStructuredData("product-detail", {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${product.brand} ${product.name}`,
    description,
    image: new URL(product.image, window.location.href).href,
    sku: product.sku || product.id,
    brand: { "@type": "Brand", name: product.brand },
    offers: {
      "@type": "Offer",
      url: window.location.href.split("#")[0],
      priceCurrency: "ZAR",
      price: Number(product.price) || 0,
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
    },
  });
};

const injectFooterTrustSection = () => {
  const footer = document.querySelector(".site-footer");
  if (!footer || document.querySelector(".site-trust-footer")) return;
  const section = document.createElement("section");
  section.className = "section site-trust-footer";
  section.setAttribute("aria-label", "Why clients choose Lullubelle");
  section.innerHTML = `
    <div class="section-heading">
      <p class="eyebrow">Why clients choose Lullubelle</p>
      <h2>Professional skincare, private appointments and trusted local care.</h2>
    </div>
    <div class="trust-grid">
      <div><span>10+</span><p><strong>10+ Years Experience</strong><small>Personal, expert care</small></p></div>
      <div><span>✦</span><p><strong>Professional Brands</strong><small>Kalahari, VitaDerm, Mesoestetic, SunSkin &amp; Soopa</small></p></div>
      <div><span>✓</span><p><strong>Qualified Skin Therapist</strong><small>Consultation-led treatments</small></p></div>
      <div><span>🔒</span><p><strong>Secure Online Shopping</strong><small>Shop with confidence</small></p></div>
      <div><span>◷</span><p><strong>Private Studio</strong><small>Appointment-only care</small></p></div>
      <div><span>★</span><p><strong>Happy Clients</strong><small>Trusted local feedback</small></p></div>
    </div>`;
  footer.before(section);
};

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

const getSelectedDeliveryOption = () => {
  const selected = document.querySelector("input[name='deliveryOption']:checked")?.value || "collection";
  return selected === "pudo" ? "pudo" : "collection";
};

const getDeliveryFee = (deliveryOption = getSelectedDeliveryOption()) => deliveryOption === "pudo" ? PUDO_DELIVERY_FEE : 0;

const getOrderTotals = (items = getCart()) => {
  const cartTotals = getCartTotals(items);
  const deliveryOption = getSelectedDeliveryOption();
  const deliveryFee = getDeliveryFee(deliveryOption);
  return {
    quantity: cartTotals.quantity,
    subtotal: cartTotals.amount,
    deliveryOption,
    discountAmount: appliedPromo.discountAmount || 0,
    deliveryFee: appliedPromo.deliveryFee == null ? deliveryFee : appliedPromo.deliveryFee,
    finalTotal: appliedPromo.total == null ? cartTotals.amount + deliveryFee : appliedPromo.total,
  };
};

const validatePromoCode = async (code = document.querySelector("[data-promo-code]")?.value) => {
  const status = document.querySelector("[data-promo-status]");
  const normalised = String(code || "").trim().toUpperCase();
  if (!normalised) { if (status) status.textContent = "Enter a promo code."; return; }
  if (status) status.textContent = "Checking promo code…";
  const details = document.querySelector("[data-checkout-details]");
  const email = new FormData(details || undefined).get("email")?.toString().trim() || "";
  const items = getCart();
  try {
    const response = await fetch(`${IKHOKHA_CHECKOUT_ENDPOINT}?action=validate-promo`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ customer: { name: "Cart customer", email: email || "pending@customer.invalid", phone: "pending" }, items, deliveryOption: getSelectedDeliveryOption(), promoCode: normalised }) });
    const data = await readCheckoutResponse(response);
    if (!response.ok) throw new Error(data.error || "This promo code is not valid.");
    appliedPromo = { code: data.promoCode, discountAmount: data.discountAmount, deliveryFee: data.deliveryFee, total: data.total };
    localStorage.setItem(PROMO_KEY, data.promoCode);
    if (status) status.textContent = data.message;
  } catch (error) {
    appliedPromo = { code: "", discountAmount: 0, deliveryFee: null, total: null };
    localStorage.removeItem(PROMO_KEY);
    if (status) status.textContent = error.message;
  }
  renderCart();
};

const removePromoCode = () => {
  appliedPromo = { code: "", discountAmount: 0, deliveryFee: null, total: null };
  localStorage.removeItem(PROMO_KEY);
  const input = document.querySelector("[data-promo-code]");
  if (input) input.value = "";
  const status = document.querySelector("[data-promo-status]");
  if (status) status.textContent = "Promo code removed.";
  renderCart();
};

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
  if (appliedPromo.code) validatePromoCode(appliedPromo.code);
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
  if (appliedPromo.code) validatePromoCode(appliedPromo.code);
};

const setCartCheckoutState = (items) => {
  const providerLinks = document.querySelectorAll("[data-cart-ikhokha-checkout]");

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

const updateDeliveryUi = () => {
  const detailsForm = document.querySelector("[data-checkout-details]");
  if (!detailsForm) return;

  const deliveryOption = getSelectedDeliveryOption();
  detailsForm.querySelectorAll("[data-address-field]").forEach((field) => {
    field.required = deliveryOption === "pudo";
    const wrapper = field.closest("label");
    if (wrapper) wrapper.hidden = deliveryOption !== "pudo";
  });
  detailsForm.querySelector("[data-address-section]")?.toggleAttribute("hidden", deliveryOption !== "pudo");
  document.querySelectorAll("[data-delivery-note]").forEach((note) => {
    note.hidden = note.dataset.deliveryNote !== deliveryOption;
  });
};

const getCheckoutDetails = () => {
  const detailsForm = document.querySelector("[data-checkout-details]");
  updateDeliveryUi();

  if (!detailsForm) {
    return {
      customer: {},
      delivery: { option: "collection", label: "Collect from Lullubelle – Centurion", fee: 0 },
      address: {},
      notes: "",
    };
  }

  if (!detailsForm.reportValidity()) {
    return null;
  }

  const formData = new FormData(detailsForm);
  const deliveryOption = formData.get("deliveryOption")?.toString() === "pudo" ? "pudo" : "collection";
  const address = {
    streetAddress: formData.get("streetAddress")?.toString().trim() || "",
    suburb: formData.get("suburb")?.toString().trim() || "",
    city: formData.get("city")?.toString().trim() || "",
    province: formData.get("province")?.toString().trim() || "",
    postalCode: formData.get("postalCode")?.toString().trim() || "",
  };

  return {
    customer: {
      name: formData.get("name")?.toString().trim() || "",
      email: formData.get("email")?.toString().trim() || "",
      phone: formData.get("phone")?.toString().trim() || "",
      address,
      notes: formData.get("notes")?.toString().trim() || "",
    },
    delivery: {
      option: deliveryOption,
      label: deliveryOption === "pudo" ? "Pudo Locker Delivery" : "Collect from Lullubelle – Centurion",
      fee: getDeliveryFee(deliveryOption),
    },
    address,
    notes: formData.get("notes")?.toString().trim() || "",
  };
};

const validateCheckout = () => {
  const status = document.querySelector("[data-cart-status]");
  const items = getCart();
  const totals = getOrderTotals(items);
  const checkoutDetails = getCheckoutDetails();

  if (!items.length) {
    if (status) {
      status.textContent = "Your cart is empty.";
    }
    return null;
  }

  if (!checkoutDetails) {
    if (status) {
      status.textContent = "Please complete the required checkout details first.";
    }
    return null;
  }

  if (checkoutDetails.delivery.option === "pudo") {
    const missingAddressFields = Object.entries(checkoutDetails.address)
      .filter(([, value]) => !value)
      .map(([key]) => key);
    if (missingAddressFields.length) {
      if (status) {
        status.textContent = "Please complete the delivery address fields for Pudo Locker Delivery.";
      }
      return null;
    }
  }

  return { status, items, totals, ...checkoutDetails };
};

const setCheckoutLoading = (loading) => {
  const button = document.querySelector("[data-cart-ikhokha-checkout]");
  const label = button?.querySelector("[data-checkout-button-label]");
  if (!button) return;

  button.disabled = loading;
  button.classList.toggle("is-loading", loading);
  button.setAttribute("aria-busy", String(loading));
  if (label) {
    label.textContent = loading ? "Redirecting to secure payment…" : "Pay Securely Online";
  }
};

const readCheckoutResponse = async (response) => {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (error) {
    console.error("iKhokha checkout returned a non-JSON response.", {
      status: response.status,
      body: text.slice(0, 500),
      error,
    });
    throw new Error([404, 405, 501].includes(response.status)
      ? "Secure checkout is not available yet. The iKhokha payment function is missing from this deployment."
      : "Secure checkout returned an unexpected response. Please contact Lullubelle for support.");
  }
};

const startIkhokhaCheckout = async () => {
  const checkout = validateCheckout();
  if (!checkout) return;

  const { status, items, totals, customer, delivery, address, notes } = checkout;
  console.info("Starting iKhokha checkout.", {
    endpoint: IKHOKHA_CHECKOUT_ENDPOINT,
    itemCount: items.length,
    subtotal: totals.subtotal,
    deliveryFee: totals.deliveryFee,
    total: totals.finalTotal,
  });
  if (status) status.textContent = "Redirecting to secure payment…";
  setCheckoutLoading(true);

  try {
    const response = await fetch(IKHOKHA_CHECKOUT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        customer,
        delivery,
        deliveryOption: delivery.option,
        deliveryFee: totals.deliveryFee,
        address,
        notes,
        items,
        promoCode: appliedPromo.code,
        subtotal: totals.subtotal,
        finalTotal: totals.finalTotal,
        total: totals.finalTotal,
        totalAmount: totals.finalTotal,
      }),
    });
    const data = await readCheckoutResponse(response);
    if (!response.ok || !data.paymentUrl) {
      console.error("iKhokha checkout API returned an error.", {
        status: response.status,
        response: data,
      });
      throw new Error(data.error || "Unable to start secure checkout. Please contact Lullubelle for support.");
    }

    trackEvent("begin_checkout", {
      payment_provider: "ikhokha",
      value: totals.finalTotal,
      currency: "ZAR",
    });
    console.info("Redirecting to iKhokha hosted payment page.", {
      orderNumber: data.orderNumber,
      testMode: data.testMode,
    });
    window.location.href = data.paymentUrl;
  } catch (error) {
    console.error("Unable to start iKhokha checkout.", error);
    if (status) {
      status.textContent = error.message || "Unable to start secure checkout. Please try again or contact Lullubelle for support.";
    }
    setCheckoutLoading(false);
  }
};

const setupIkhokhaCheckout = () => {
  const button = document.querySelector("[data-cart-ikhokha-checkout]");
  if (!button) {
    if (document.querySelector("[data-cart-page]")) {
      console.warn("iKhokha checkout button was not found on the cart page.", {
        selector: "[data-cart-ikhokha-checkout]",
      });
    }
    return;
  }
  if (button.dataset.checkoutBound === "true") return;
  button.dataset.checkoutBound = "true";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    startIkhokhaCheckout();
  });
  console.info("iKhokha checkout button is ready.", {
    endpoint: IKHOKHA_CHECKOUT_ENDPOINT,
    selector: "[data-cart-ikhokha-checkout]",
    id: button.id || "",
  });
};

const setupIkhokhaCheckoutWhenReady = () => {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupIkhokhaCheckout, { once: true });
  } else {
    setupIkhokhaCheckout();
  }
};

const renderCart = () => {
  const container = document.querySelector("[data-cart-items]");
  const emptyState = document.querySelector("[data-cart-empty]");
  const summaryCount = document.querySelector("[data-cart-summary-count]");
  const summarySubtotal = document.querySelector("[data-cart-summary-subtotal]");
  const summaryDelivery = document.querySelector("[data-cart-summary-delivery]");
  const summaryDiscount = document.querySelector("[data-cart-summary-discount]");
  const summaryTotal = document.querySelector("[data-cart-summary-total]");

  if (!container) {
    return;
  }

  const items = getCart();
  updateDeliveryUi();
  const totals = getOrderTotals(items);

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
  if (summarySubtotal) {
    summarySubtotal.textContent = formatCurrency(totals.subtotal);
  }
  if (summaryDelivery) {
    summaryDelivery.textContent = formatCurrency(totals.deliveryFee);
  }
  if (summaryDiscount) summaryDiscount.textContent = totals.discountAmount ? `-${formatCurrency(totals.discountAmount)}` : formatCurrency(0);
  if (summaryTotal) {
    summaryTotal.textContent = formatCurrency(totals.finalTotal);
  }

  setCartCheckoutState(items);
  const promoInput = document.querySelector("[data-promo-code]");
  if (promoInput && document.activeElement !== promoInput) promoInput.value = appliedPromo.code;
  document.querySelector("[data-promo-remove]")?.toggleAttribute("hidden", !appliedPromo.code);
};

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
  const disabledCheckout = target?.closest("[data-cart-ikhokha-checkout][aria-disabled='true']");
  const promoApply = target?.closest("[data-promo-apply]");
  const promoRemove = target?.closest("[data-promo-remove]");

  if (promoApply) { validatePromoCode(); return; }
  if (promoRemove) { removePromoCode(); return; }

  if (disabledCheckout) {
    event.preventDefault();
    return;
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
    removePromoCode();
    updateCartCount();
  }
});

document.addEventListener("change", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.matches("input[name='deliveryOption']")) {
    const status = document.querySelector("[data-cart-status]");
    if (status) status.textContent = "";
    updateDeliveryUi();
    renderCart();
    if (appliedPromo.code) validatePromoCode(appliedPromo.code);
  }
});

updateCartCount();
renderCart();
if (appliedPromo.code && document.querySelector("[data-cart-page]")) validatePromoCode(appliedPromo.code);
setupIkhokhaCheckoutWhenReady();

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

    if (/product|stock|Kalahari|VitaDerm|Mesoestetic|SunSkin|Soopa|nail|lash|body care/i.test(enquiryText)) {
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
  sendAdminRecord("/.netlify/functions/admin-booking", {
    clientName: name || "",
    phone: formData.get("phone")?.toString().trim() || "",
    email: formData.get("email")?.toString().trim() || "",
    treatment: treatment || "",
    preferredDate: date || "",
    preferredTime: time || "",
    notes: message || "",
    source: "website_booking_form",
  });
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
  sendAdminRecord("/.netlify/functions/admin-booking", {
    clientName: formData.get("name")?.toString() || "",
    phone: formData.get("mobile")?.toString() || "",
    email: formData.get("email")?.toString() || "",
    treatment: formData.get("service")?.toString() || "",
    preferredDate: formData.get("date")?.toString() || "",
    preferredTime: formData.get("time")?.toString() || "",
    notes: [
      formData.get("notes")?.toString() || "",
      `First-time client: ${formData.get("firstTime") || "Not specified"}`,
      `Preferred contact: ${formData.get("contactMethod") || "Not specified"}`,
    ].filter(Boolean).join(" | "),
    source: "appointment_page_form",
  });
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

setupBrandFilters();
loadManagedContent()
  .then((content) => {
    applyManagedContent(content);
  })
  .finally(() => {
    setupResultsFilters();
    setupResultLightbox();
    setupPageStructuredData();
    renderProductDetailPage();
    injectFooterTrustSection();
  });
