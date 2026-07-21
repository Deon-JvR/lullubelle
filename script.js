const navToggle = document.querySelector("[data-nav-toggle]");
const nav = document.querySelector("[data-nav]");
const bookingForm = document.querySelector("[data-booking-form]");
const appointmentBookingForm = document.querySelector("[data-appointment-booking-form]");
const consultationCartForm = document.querySelector("[data-consultation-cart-form]");
const config = window.LULLUBELLE_CONFIG || {};
const analyticsId = config.googleAnalyticsId || "G-7PG6BZR9QV";

const injectLegalFooterLinks = () => {
  const footer = document.querySelector(".site-footer");
  if (!footer || footer.querySelector("[data-legal-footer-links], a[href='/refund-policy']")) return;

  const links = document.createElement("nav");
  links.className = "footer-links legal-footer-links";
  links.setAttribute("aria-label", "Legal policies");
  links.setAttribute("data-legal-footer-links", "");
  links.innerHTML = '<a href="/refund-policy">Refund Policy</a><a href="/shipping-policy">Shipping Policy</a><a href="/privacy-policy">Privacy Policy</a>';

  const footerBottom = footer.querySelector(".footer-bottom");
  if (footerBottom) footer.insertBefore(links, footerBottom);
  else footer.append(links);
};

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

  const activateFilter = (filter) => {
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
  };

  filters.forEach((filter) => {
    filter.addEventListener("click", () => activateFilter(filter));
  });

  const requested = new URLSearchParams(window.location.search).get("filter")?.toLowerCase();
  const requestedFilter = requested && Array.from(filters).find((filter) => !filter.hidden && filter.dataset.resultsFilter.toLowerCase() === requested);
  if (requestedFilter) activateFilter(requestedFilter);
};

const appendStructuredData = (key, data) => {
  const serverNode = key === "product-detail"
    ? document.querySelector("script[data-server-product-schema]")
    : key === "breadcrumb" ? document.querySelector("script[data-server-breadcrumb-schema]") : null;
  if (serverNode) {
    serverNode.textContent = JSON.stringify(data);
    return;
  }
  const existing = document.querySelector(`script[data-generated-schema="${key}"]`);
  if (existing) {
    existing.textContent = JSON.stringify(data);
    return;
  }
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
      sku: button.dataset.productSku || id,
      brand: { "@type": "Brand", name: brand },
      category: card?.dataset.productCategoryNames || undefined,
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
  document.querySelector("[data-server-category-products]")?.remove();
  const products = getActiveCatalogueProducts(content?.products).map(normaliseManagedProduct);
  const brands = getCatalogueBrands(content, products);
  const tabs = document.querySelector(".supplier-tabs");
  const payments = document.querySelector(".payments-section");
  if (!tabs || !payments || !brands.length) return;

  const parameters = new URLSearchParams(window.location.search);
  const requestedBrand = parameters.get("brand");
  const requestedCategory = parameters.get("category");
  let query = parameters.get("q") || "";
  let selectedBrand = brands.find((brand) => requestedBrand && (brand.id.toLowerCase() === requestedBrand.toLowerCase() || brand.name.toLowerCase() === requestedBrand.toLowerCase()))?.id
    || ((requestedCategory || query) ? "all" : brands[0].id);
  let selectedCategory = requestedCategory || "all";
  const categories = Array.isArray(content?.productCategories) ? content.productCategories : [];

  tabs.innerHTML = [{ id: "all", name: "All Products" }, ...brands].map((brand) => `<button class="supplier-tab ${brand.id === selectedBrand ? "is-active" : ""}" type="button" data-brand-filter="${escapeHtml(brand.id)}" aria-pressed="${brand.id === selectedBrand ? "true" : "false"}">${escapeHtml(brand.name)}</button>`).join("");
  document.querySelectorAll("[data-brand-panel]").forEach((panel) => panel.remove());
  payments.insertAdjacentHTML("beforebegin", `<section class="section product-price-section" data-shop-catalogue>
    <div class="section-heading" data-shop-catalogue-heading></div>
    <div class="shop-catalogue-tools">
      <label>Search products<input type="search" value="${escapeHtml(query)}" placeholder="Search by product, SKU or keyword" data-shop-product-search></label>
      <label>Category<select data-shop-category><option value="all">All categories</option>${categories.map((category) => `<option value="${escapeHtml(category)}" ${category === selectedCategory ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select></label>
    </div>
    <p class="shop-catalogue-status" aria-live="polite" data-shop-catalogue-status></p>
    <div class="kalahari-grid" aria-live="polite" data-shop-product-grid></div>
    <div class="stock-note"><p>Product availability can change. Lullubelle will confirm stock before completing your order.</p></div>
  </section>`);

  const section = document.querySelector("[data-shop-catalogue]");
  const heading = section.querySelector("[data-shop-catalogue-heading]");
  const grid = section.querySelector("[data-shop-product-grid]");
  const status = section.querySelector("[data-shop-catalogue-status]");
  const search = section.querySelector("[data-shop-product-search]");
  const categorySelect = section.querySelector("[data-shop-category]");
  const shopHeroHeading = document.querySelector(".shop-hero h1");
  const shopHeroDescription = document.querySelector(".shop-hero .lead");
  if (selectedCategory !== "all" && !categories.includes(selectedCategory)) selectedCategory = "all";

  const updateUrl = () => {
    const next = new URL(window.location.href);
    if (selectedBrand === "all") next.searchParams.delete("brand"); else next.searchParams.set("brand", selectedBrand);
    if (selectedCategory === "all") next.searchParams.delete("category"); else next.searchParams.set("category", selectedCategory);
    if (query.trim()) next.searchParams.set("q", query.trim()); else next.searchParams.delete("q");
    window.history.replaceState({}, "", `${next.pathname}${next.search}${next.hash}`);
  };

  const render = () => {
    const brand = brands.find((item) => item.id === selectedBrand);
    const queryKey = query.trim().toLowerCase();
    const exactSkuSearch = queryKey && products.some((product) => String(product.sku || "").toLowerCase() === queryKey);
    const filtered = products.filter((product) => {
      const brandMatch = selectedBrand === "all" || (brand && productMatchesBrand(product, brand));
      const categoryMatch = selectedCategory === "all" || product.categories.includes(selectedCategory);
      const searchText = [product.brand, product.name, product.sku, product.size, ...product.categories, product.description, product.searchKeywords].join(" ").toLowerCase();
      const searchMatch = !queryKey || (exactSkuSearch ? String(product.sku || "").toLowerCase() === queryKey : searchText.includes(queryKey));
      return brandMatch && categoryMatch && searchMatch;
    });
    const title = selectedCategory !== "all" ? `${selectedCategory} products${brand ? ` from ${brand.name}` : ""}` : brand ? `${brand.name} products` : "All products";
    const description = selectedCategory !== "all" ? `Browse Lullubelle products assigned to the ${selectedCategory} category. Compare available brands and open each product for its current details.` : "Browse current products available through Lullubelle.";
    heading.innerHTML = `<p class="eyebrow">Product catalogue</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p>`;
    const pageTitle = selectedCategory !== "all" ? `${selectedCategory} Skincare Products | Lullubelle` : "Shop Skin Products | Lullubelle Beauty Specialist Centurion";
    document.title = pageTitle;
    if (shopHeroHeading) shopHeroHeading.textContent = selectedCategory !== "all" ? `${selectedCategory} skincare products` : "Invest in your skin.";
    if (shopHeroDescription) shopHeroDescription.textContent = selectedCategory !== "all" ? description : "Choose a professional skincare range for your home-care routine.";
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) metaDescription.content = description;
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.href = selectedCategory !== "all" ? `${window.location.origin}/shop?category=${encodeURIComponent(selectedCategory)}` : `${window.location.origin}/shop`;
    setMetaContent('meta[property="og:title"]', pageTitle);
    setMetaContent('meta[property="og:description"]', description);
    setMetaContent('meta[property="og:url"]', canonical?.href || `${window.location.origin}/shop`);
    setMetaContent('meta[name="twitter:title"]', pageTitle);
    setMetaContent('meta[name="twitter:description"]', description);
    grid.innerHTML = filtered.length ? filtered.map(renderManagedProductCard).join("") : `<p>No products match the selected brand, category and search.</p>`;
    status.textContent = `Showing ${filtered.length} of ${products.length} active products`;
    tabs.querySelectorAll("[data-brand-filter]").forEach((button) => {
      const active = button.dataset.brandFilter === selectedBrand;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    bindProductButtons(grid);
    syncProductSchemas(grid);
  };

  tabs.querySelectorAll("[data-brand-filter]").forEach((button) => button.addEventListener("click", () => {
    selectedBrand = button.dataset.brandFilter;
    updateUrl();
    render();
    trackEvent("shop_supplier_filter", { supplier: selectedBrand });
  }));
  search.addEventListener("input", () => { query = search.value; updateUrl(); render(); });
  categorySelect.addEventListener("change", () => { selectedCategory = categorySelect.value; updateUrl(); render(); });
  render();
};

const setupHomepageBrands = (content) => {
  const grid = document.querySelector("[data-shop-brands]");
  if (!grid) return;

  const products = getActiveCatalogueProducts(content?.products).map(normaliseManagedProduct);
  const brands = getCatalogueBrands(content, products);
  if (!brands.length) return;

  grid.innerHTML = brands.map((brand) => {
    const productCount = products.filter((product) => productMatchesBrand(product, brand)).length;
    const description = productCount
      ? `${productCount} ${productCount === 1 ? "product" : "products"}`
      : "Professional skincare range";
    return `<a class="shop-brand-card" href="/shop?brand=${encodeURIComponent(brand.id || brand.name)}"><span>${escapeHtml(brand.name)}</span><small>${escapeHtml(description)}</small></a>`;
  }).join("");
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

  grid.innerHTML = featured.slice(0, 8).map((product, index) => `
    <article class="product-card featured-product-card home-product-card">
      <a class="product-card__image-wrap featured-product-image" href="${escapeHtml(productDetailUrl(product.id))}" aria-label="View ${escapeHtml(product.brand)} ${escapeHtml(product.name)}">
        ${product.bestSeller ? '<span class="product-status-badge">Best Seller</span>' : product.featured ? '<span class="product-status-badge">Featured</span>' : ""}
        <img class="product-card__image" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.imageAlt)}" width="650" height="650" decoding="async" loading="${index < 4 ? "eager" : "lazy"}"${index < 4 ? ' fetchpriority="high"' : ""}>
      </a>
      <div class="product-card__content">
        <span class="product-brand-badge" data-brand="${escapeHtml(product.brand.toLowerCase())}">${escapeHtml(product.brand)}</span>
        <h3 class="product-card__title" title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</h3>
        <strong class="product-card__price">${formatCurrency(product.price)}</strong>
        <p class="product-description">${escapeHtml(product.benefit)}</p>
        <div class="product-card__actions featured-product-actions">
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
const CHECKOUT_FULFILMENT_KEY = "lullubelleCheckoutFulfilment";
const isDigitalOnlyItem = (item) => /^(gift-voucher-|online-skin-consultation)/i.test(String(item?.id || ""));
const requiresPhysicalFulfilment = (items) => Array.isArray(items) && items.some((item) => !isDigitalOnlyItem(item));
const processingDetail = (deliveryOption) => deliveryOption === "pudo"
  ? "Delivery transit time begins only after your order has been dispatched."
  : "Collection is available only after we notify you that your order is ready.";
const PROMO_KEY = "lullubellePromoCode";
const IKHOKHA_CHECKOUT_ENDPOINT = "/.netlify/functions/ikhokha-checkout";
const DOOR_TO_DOOR_METHOD = "door_to_door_flat_rate";
const DOOR_TO_DOOR_FEE = 80;
const SUPPORTED_DELIVERY_METHODS = new Set(["collection", "pudo", DOOR_TO_DOOR_METHOD]);
const DEFAULT_DELIVERY_SETTINGS = { freeDeliveryThreshold: 1000, standardPudoFee: 80, collectionEnabled: true };
let deliverySettings = { ...DEFAULT_DELIVERY_SETTINGS };
let appliedPromo = { code: localStorage.getItem(PROMO_KEY) || "", discountAmount: 0, productDiscount: 0, deliveryFee: null, total: null };
const currencyFormatter = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatCurrency = (value) => currencyFormatter.format(Number(value) || 0).replace("ZAR", "R").replace(/\s/g, "").replace(",", ".");

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
  const [brands, products, treatments, gallery, vouchers, productCategories] = await Promise.all(
    ["brands", "products", "treatments", "gallery", "vouchers", "product-categories"].map(readItems),
  );
  return { brands, products, treatments, gallery, vouchers, productCategories };
};

const loadManagedContent = async () => {
  if (!managedContentPromise) {
    managedContentPromise = fetch(`/.netlify/functions/admin-content?fresh=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json", "Cache-Control": "no-cache" } })
      .then((response) => response.ok ? response.json() : null)
      .then(async (content) => {
        const fallback = await loadStaticContent();
        const managedProducts = Array.isArray(content?.products) ? content.products : [];
        const products = hasCompleteProductCatalogue(managedProducts, fallback.products)
          ? managedProducts
          : mergeProductCollections(fallback.products, managedProducts);
        return {
          ...content,
          products,
          productCategories: Array.isArray(content?.productCategories) ? content.productCategories : fallback.productCategories,
          brands: mergeCollections(fallback.brands, content?.brands),
          treatments: Array.isArray(content?.treatments) ? content.treatments : fallback.treatments,
          gallery: Array.isArray(content?.gallery) ? content.gallery : fallback.gallery,
          vouchers: Array.isArray(content?.vouchers) ? content.vouchers : fallback.vouchers,
          deliverySettings: content?.deliverySettings || { ...DEFAULT_DELIVERY_SETTINGS },
          updatedAt: content?.updatedAt || new Date().toISOString(),
        };
      })
      .catch(async () => {
        const fallback = await loadStaticContent();
        return {
          ...fallback,
          deliverySettings: { ...DEFAULT_DELIVERY_SETTINGS },
          updatedAt: new Date().toISOString(),
        };
      });
  }
  return managedContentPromise;
};

const getVisibleManagedItems = (items) => Array.isArray(items)
  ? items.filter((item) => item && item.hidden !== true)
  : [];

const mergeCollections = (fallbackItems = [], managedItems = []) => {
  const merged = new Map();
  [...(Array.isArray(fallbackItems) ? fallbackItems : []), ...(Array.isArray(managedItems) ? managedItems : [])]
    .filter(Boolean)
    .forEach((item) => {
      const key = String(item.id || item.name || "").trim().toLowerCase();
      if (key) merged.set(key, { ...(merged.get(key) || {}), ...item });
    });
  return [...merged.values()];
};

const mergeProductCollections = (fallbackProducts = [], managedProducts = []) => {
  const merged = new Map();
  (Array.isArray(fallbackProducts) ? fallbackProducts : []).forEach((product) => {
    const key = String(product?.id || "").trim().toLowerCase();
    if (key) merged.set(key, product);
  });
  (Array.isArray(managedProducts) ? managedProducts : []).forEach((product) => {
    const key = String(product?.id || "").trim().toLowerCase();
    if (key) merged.set(key, product);
  });
  return [...merged.values()];
};

const PLACEHOLDER_BRANDS = new Set(["brand", "unknown", "other", "none", "n/a", "na", "unbranded", "placeholder", "test", "lullubelle"]);
const isGenuineBrandName = (value) => {
  const name = String(value || "").trim();
  return Boolean(name) && !PLACEHOLDER_BRANDS.has(name.toLowerCase()) && !/^new brand\b/i.test(name);
};
const getActiveCatalogueProducts = (items) => getVisibleManagedItems(items).filter((product) => (
  product.active !== false
  && product.published !== false
  && !/^(?:draft|inactive|archived)$/i.test(String(product.status || "").trim())
  && isGenuineBrandName(product.brand)
));
const productMatchesBrand = (product, brand) => (
  Boolean(product.brandId && brand.id && product.brandId.toLowerCase() === brand.id.toLowerCase())
  || product.brand.toLowerCase() === brand.name.toLowerCase()
);
const getCatalogueBrands = (content, normalisedProducts = []) => {
  const configured = (Array.isArray(content?.brands) ? content.brands : [])
    .filter((brand) => brand?.active !== false && isGenuineBrandName(brand.name));
  const candidates = configured
    .filter((brand) => normalisedProducts.some((product) => productMatchesBrand(product, brand)) || brand.hideWhenEmpty === false)
    .concat(normalisedProducts.map((product, index) => ({
      id: product.brandId || slugify(product.brand),
      name: product.brand,
      order: configured.length + index + 1,
      active: true,
    })));
  const seenNames = new Set();
  const seenIds = new Set();
  return candidates
    .sort((a, b) => Number(a.order ?? Number.MAX_SAFE_INTEGER) - Number(b.order ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name))
    .filter((brand) => {
      const nameKey = brand.name.trim().toLowerCase();
      const idKey = String(brand.id || "").trim().toLowerCase();
      if (seenNames.has(nameKey) || (idKey && seenIds.has(idKey))) return false;
      seenNames.add(nameKey);
      if (idKey) seenIds.add(idKey);
      return true;
    });
};

const normaliseGalleryItems = (items = []) => {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).flatMap((item, index) => {
    const id = String(item?.id || "").trim();
    let image = String(item?.image || "").trim();
    if (/^\.\.\/before-after-images\//i.test(image)) image = `/${image.replace(/^\.\.\//, "")}`;
    const validImage = /^(?:\/before-after-images\/|\/\.netlify\/functions\/admin-asset\?key=|https?:\/\/)/i.test(image)
      && !/(?:^|\/)(?:lullubelle-logo|placeholder)(?:[.\-_\/]|$)|^data:image/i.test(image);
    const published = item?.hidden !== true && item?.active !== false && item?.published !== false && !/^(draft|inactive|archived)$/i.test(String(item?.status || ""));
    if (!id || seen.has(id) || !validImage || !published) return [];
    seen.add(id);
    return [{ ...item, id, image, order: Number.isFinite(Number(item.order)) ? Number(item.order) : index + 1 }];
  }).sort((a, b) => a.order - b.order || String(a.title || "").localeCompare(String(b.title || "")) || a.id.localeCompare(b.id));
};

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
    slug: product.slug || product.id || `${slugify(brand)}-${slugify(name)}`,
    brandId: product.brandId || slugify(brand),
    brand,
    name,
    price: Object.hasOwn(product, "price") ? product.price : 0,
    image: product.image || "lullubelle-logo.jpg",
    benefit: product.benefit || product.description || "Professional home care selected by Lullubelle.",
    description: product.description || product.benefit || "Professional skincare available from Lullubelle Beauty Specialist.",
    directions: product.directions || "Use as directed by your skin therapist.",
    ingredients: product.ingredients || "Please confirm current ingredients with Lullubelle before purchase.",
    suitable: product.suitable || "Selected skin routines after consultation.",
    size: product.size || "",
    sku: product.sku || product.id || `${slugify(brand)}-${slugify(name)}`,
    searchKeywords: Array.isArray(product.searchKeywords) ? product.searchKeywords.join(" ") : product.searchKeywords || "",
    stockStatus: product.stockStatus || "In stock",
    featured: product.featured === true,
    bestSeller: product.bestSeller === true,
    categories: Array.isArray(product.categories) ? [...new Set(product.categories)] : [],
    benefits: Array.isArray(product.benefits) ? product.benefits : [],
    storage: Array.isArray(product.storage) ? product.storage : [],
    imageAlt: product.imageAlt || `${brand} ${name}`,
    galleryImages: (Array.isArray(product.galleryImages) ? product.galleryImages : []).flatMap((item, index) => {
      const normalised = typeof item === "string" ? { id: `${product.id}-gallery-${index + 1}`, url: item, alt: "" } : item;
      const url = String(normalised?.url || "").trim();
      if (!url || /^(?:data|blob):/i.test(url) || /(?:^|\/)(?:lullubelle-logo|placeholder)(?:[._/?-]|$)/i.test(url)) return [];
      return [{ id: normalised.id || `${product.id}-gallery-${index + 1}`, url, alt: normalised.alt || `${brand} ${name} gallery image ${index + 1}` }];
    }),
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

const renderManagedProductCard = (product, index = 0) => {
  const disabled = isPurchasable(product) ? "" : " disabled";
  const label = isPurchasable(product) ? "Add to cart" : stockLabel(product.stockStatus);
  const badge = product.bestSeller ? "Best Seller" : product.featured ? "Featured" : "";
  return `
    <article class="product-card kalahari-item" data-product-id="${escapeHtml(product.id)}" data-product-sku="${escapeHtml(product.sku)}" data-product-categories="${escapeHtml(product.categories.map(slugify).join(" "))}" data-product-category-names="${escapeHtml(product.categories.join(", "))}">
      ${badge ? `<span class="product-status-badge">${escapeHtml(badge)}</span>` : ""}
      <div class="product-card__image-wrap product-image-wrap"><img class="product-card__image" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.imageAlt)}" width="650" height="650" decoding="async" loading="${index < 4 ? "eager" : "lazy"}"${index < 4 ? ' fetchpriority="high"' : ""}></div>
      <div class="product-card__content">
        <span class="product-brand-badge" data-brand="${escapeHtml(product.brand.toLowerCase())}">${escapeHtml(product.brand)}</span>
        <h3 class="product-card__title" title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</h3>
        ${product.size ? `<span class="product-size">${escapeHtml(product.size)}</span>` : ""}
        ${product.categories.length ? `<div class="product-category-links">${product.categories.map((category) => `<a class="product-category-link" href="/shop?category=${encodeURIComponent(category)}">${escapeHtml(category)}</a>`).join(" ")}</div>` : ""}
        <p>${escapeHtml(product.benefit)}</p>
        <strong class="product-card__price">${formatCurrency(product.price)}</strong>
        <span class="product-stock"><span aria-hidden="true"></span> ${escapeHtml(stockLabel(product.stockStatus))}</span>
      </div>
      <div class="product-card__actions product-card-actions">
        <button class="button secondary" type="button" data-managed-cart-add data-product-id="${escapeHtml(product.id)}" data-product-sku="${escapeHtml(product.sku)}" data-product-name="${escapeHtml(product.brand)} ${escapeHtml(product.name)}" data-product-price="${Number(product.price)}" data-product-image="${escapeHtml(product.image)}"${disabled}>${escapeHtml(label)}</button>
        <a class="text-link" href="${escapeHtml(productDetailUrl(product.slug))}">View Product</a>
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
  const visible = normaliseGalleryItems(gallery);
  const grid = document.querySelector(".results-gallery-section .results-grid");
  if (!grid) return;
  if (!visible.length) {
    grid.innerHTML = "<p>Before &amp; After results are temporarily unavailable.</p>";
    grid.dataset.galleryState = "empty";
    return;
  }

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
  grid.dataset.galleryState = "ready";
  grid.querySelectorAll("img").forEach((image) => image.addEventListener("error", () => image.closest("[data-results-card]")?.remove(), { once: true }));
  appendStructuredData("managed-gallery", {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: visible.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "ImageObject",
        name: item.title || "Before and after treatment result",
        caption: item.description || undefined,
        contentUrl: new URL(item.image, window.location.origin).href,
      },
    })),
  });
};

const applyHomepageGallery = (gallery = []) => {
  const grid = document.querySelector(".home-results-grid");
  if (!grid) return;
  const featured = normaliseGalleryItems(gallery)
    .filter((item) => item.featured)
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
  grid.querySelectorAll("img").forEach((image) => image.addEventListener("error", () => image.closest(".home-result-card")?.remove(), { once: true }));
};

const applyTreatmentGalleryPreviews = (gallery = []) => {
  const visible = normaliseGalleryItems(gallery);
  document.querySelectorAll("[data-managed-gallery-preview]").forEach((section) => {
    const requested = String(section.dataset.managedGalleryPreview || "").split(/\s+/).filter(Boolean);
    const item = visible.find((candidate) => {
      const categories = `${candidate.categories || ""} ${slugify(candidate.category || "")}`.split(/\s+/);
      return requested.some((category) => categories.includes(category));
    });
    if (!item) {
      section.hidden = true;
      section.dataset.galleryState = "empty";
      return;
    }
    section.hidden = false;
    const media = section.querySelector("[data-managed-gallery-media]");
    const title = section.querySelector("[data-managed-gallery-title]");
    const eyebrow = section.querySelector("[data-managed-gallery-category]");
    if (title) title.textContent = item.title || "Before & After result";
    if (eyebrow) eyebrow.textContent = item.category || "Client result";
    if (media) {
      media.innerHTML = `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title || "Before and after treatment result")}" width="1200" height="1200" loading="lazy" decoding="async">`;
      media.querySelector("img")?.addEventListener("error", () => { section.hidden = true; }, { once: true });
    }
    section.dataset.galleryState = "ready";
  });
};

const applyManagedTreatments = (treatments = []) => {
  const visible = getVisibleManagedItems(treatments);
  if (!visible.length) return;

  const renderTreatmentItems = (items) => {
    const groups = items.reduce((map, treatment) => {
      const group = String(treatment.group || "").trim();
      if (!map.has(group)) map.set(group, []);
      map.get(group).push(treatment);
      return map;
    }, new Map());
    return Array.from(groups.entries()).map(([group, groupItems]) => `
      ${group ? `<h3 class="treatment-subgroup">${escapeHtml(group)}</h3>` : ""}
      <ul class="treatment-list simple-list">
        ${groupItems.map((treatment) => {
          const showDuration = treatment.duration && treatment.duration !== treatment.name;
          return `<li data-service-id="${escapeHtml(treatment.id)}">
            <span class="treatment-copy"><strong>${escapeHtml(treatment.name || "Treatment")}</strong>${showDuration ? `<small class="treatment-duration">${escapeHtml(treatment.duration)}</small>` : ""}${treatment.description ? `<small class="treatment-description">${escapeHtml(treatment.description)}</small>` : ""}</span>
            <b class="treatment-price">${escapeHtml(treatment.price || "Confirm")}</b>
          </li>`;
        }).join("")}
      </ul>`).join("");
  };

  const menuGrid = document.querySelector(".treatment-menu-grid");
  if (menuGrid) {
    const grouped = visible.reduce((groups, treatment) => {
      const category = treatment.category || "Treatments";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(treatment);
      return groups;
    }, new Map());
    menuGrid.innerHTML = Array.from(grouped.entries()).map(([category, items]) => `
      <article class="treatment-menu-card${items.length >= 8 ? " treatment-menu-card--wide" : ""}" id="category-${slugify(category)}" data-service-category="${escapeHtml(category)}">
        <h2 class="treatment-heading">${escapeHtml(category)}</h2>
        ${renderTreatmentItems(items)}
      </article>`).join("");
  }

  const bookingSelect = document.querySelector("[data-treatment-service-select]");
  if (bookingSelect) {
    const grouped = visible.reduce((groups, treatment) => {
      const category = treatment.category || "Treatments";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(treatment);
      return groups;
    }, new Map());
    bookingSelect.innerHTML = `<option value="">Choose a service</option>${Array.from(grouped.entries()).map(([category, items]) => `
      <optgroup label="${escapeHtml(category)}">${items.map((treatment) => {
        const name = [treatment.group, treatment.name].filter(Boolean).join(" — ");
        const label = `${category} — ${name} — ${treatment.price || "Confirm"}`;
        return `<option value="${escapeHtml(label)}">${escapeHtml(name)} — ${escapeHtml(treatment.price || "Confirm")}</option>`;
      }).join("")}</optgroup>`).join("")}<optgroup label="Other"><option>Product Advice</option><option>Gift Voucher</option><option>Other</option></optgroup>`;
  }

  const catalogueSchema = document.querySelector("[data-service-catalogue-schema]");
  if (catalogueSchema) {
    const offers = visible.filter((treatment) => treatment.pdfSource !== false).map((treatment) => ({
      "@type": "Offer",
      name: [treatment.category, treatment.group, treatment.name].filter(Boolean).join(" — "),
      priceCurrency: "ZAR",
      price: String(treatment.price || "").replace(/\D/g, ""),
      itemOffered: {
        "@type": "Service",
        name: [treatment.group, treatment.name].filter(Boolean).join(" — "),
        ...(treatment.duration ? { duration: treatment.duration } : {}),
      },
    }));
    catalogueSchema.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "OfferCatalog",
      "@id": "https://www.lullubelle.co.za/pricelist#pricelist",
      name: "Lullubelle Beauty Specialist treatment pricelist",
      url: "https://www.lullubelle.co.za/pricelist",
      provider: { "@id": "https://www.lullubelle.co.za/#business" },
      itemListElement: offers,
    });
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
  setupHomepageBrands(content);
  setupFeaturedProducts(content);
  applyManagedVouchers(content.vouchers);
  applyManagedGallery(content.gallery);
  applyHomepageGallery(content.gallery);
  applyTreatmentGalleryPreviews(content.gallery);
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
const productDetailUrl = (slug) => `/products/${encodeURIComponent(slug)}`;

const setMetaContent = (selector, content) => document.querySelector(selector)?.setAttribute("content", content);

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
  const product = products.find((item) => item.id === requestedId || item.slug === requestedId) || products[0];
  const related = products
    .filter((item) => item.id !== product.id && item.brand === product.brand)
    .slice(0, 3);
  const description = product.description || product.benefit || `${product.brand} ${product.name} is available through Lullubelle Beauty Specialist in Centurion.`;

  const productTitle = product.seoTitle || `${product.brand} ${product.name} | Lullubelle Skincare Centurion`;
  const productDescription = product.seoDescription || `${product.brand} ${product.name} from Lullubelle Beauty Specialist in Centurion. View benefits, directions, skin suitability and order online.`;
  const productUrl = `https://www.lullubelle.co.za${productDetailUrl(product.slug)}`;
  const productImage = new URL(product.image, "https://www.lullubelle.co.za/").href;
  document.title = productTitle;
  setMetaContent('meta[name="description"]', productDescription);
  document.querySelector('link[rel="canonical"]')?.setAttribute("href", productUrl);
  setMetaContent('meta[property="og:title"]', productTitle);
  setMetaContent('meta[property="og:description"]', productDescription);
  setMetaContent('meta[property="og:url"]', productUrl);
  setMetaContent('meta[property="og:image"]', productImage);
  setMetaContent('meta[property="og:type"]', "product");
  setMetaContent('meta[name="twitter:card"]', "summary_large_image");
  setMetaContent('meta[name="twitter:title"]', productTitle);
  setMetaContent('meta[name="twitter:description"]', productDescription);
  setMetaContent('meta[name="twitter:image"]', productImage);

  container.innerHTML = `
    <section class="section product-detail product-detail-page-hero">
      <div class="product-detail-media">
        <img class="product-detail-main-image" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.imageAlt)}" width="900" height="900" decoding="async" loading="eager" fetchpriority="high">
        ${product.galleryImages.length ? `<div class="product-detail-gallery" aria-label="Additional product images">${product.galleryImages.map((image) => `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}" width="320" height="320" decoding="async" loading="lazy">`).join("")}</div>` : ""}
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
            <div class="product-card-actions"><a class="button secondary" href="${escapeHtml(productDetailUrl(item.slug))}" data-product-navigation>View Product</a></div>
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
  container.querySelectorAll("[data-product-navigation]").forEach((link) => link.addEventListener("click", (event) => {
    event.preventDefault();
    window.history.pushState({}, "", link.getAttribute("href"));
    renderProductDetailPage();
  }));

  appendStructuredData("product-detail", {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description,
    image: [product.image, ...product.galleryImages.map((item) => item.url)].map((url) => new URL(url, window.location.href).href),
    sku: product.sku || product.id,
    brand: { "@type": "Brand", name: product.brand },
    category: product.categories.join(", "),
    url: productUrl,
    offers: {
      "@type": "Offer",
      url: productUrl,
      priceCurrency: "ZAR",
      price: product.price,
      availability: /out/i.test(product.stockStatus) ? "https://schema.org/OutOfStock" : /coming|pre.?order/i.test(product.stockStatus) ? "https://schema.org/PreOrder" : "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
    },
  });
  appendStructuredData("breadcrumb", {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${window.location.origin}/` },
      { "@type": "ListItem", position: 2, name: "Shop", item: `${window.location.origin}/shop` },
      { "@type": "ListItem", position: 3, name: product.name, item: productUrl },
    ],
  });
};

const injectFooterTrustSection = () => {
  const footer = document.querySelector(".site-footer");
  if (!footer) return;
  if (!document.querySelector(".site-trust-footer")) {
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
  }

  const topTarget = document.documentElement;
  if (!topTarget.id) topTarget.id = "top";
  const bottomMarkup = `
    <p>© 2026 Lullubelle Beauty Specialist</p>
    <nav class="footer-bottom-links" aria-label="Footer navigation">
      <a href="https://zyam.co.za/" target="_blank" rel="noopener noreferrer" aria-label="Visit the Zyam website (opens in a new tab)">Website by Zyam</a>
      <a href="#${escapeHtml(topTarget.id)}" aria-label="Back to top of page">Back to top</a>
    </nav>`;
  if (footer.classList.contains("storefront-footer")) {
    let bottom = footer.querySelector(".footer-bottom");
    if (!bottom) {
      bottom = document.createElement("div");
      bottom.className = "footer-bottom";
      footer.appendChild(bottom);
    }
    bottom.innerHTML = bottomMarkup;
  } else {
    footer.innerHTML = `<div class="footer-bottom">${bottomMarkup}</div>`;
  }
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

const clearCart = () => {
  saveCart([]);
  appliedPromo = { code: "", discountAmount: 0, productDiscount: 0, deliveryFee: null, total: null };
  localStorage.removeItem(PROMO_KEY);
  updateCartCount();
  renderCart();
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
  return SUPPORTED_DELIVERY_METHODS.has(selected) ? selected : "collection";
};

const updateOrderProcessingNotices = (items = getCart()) => {
  const physical = requiresPhysicalFulfilment(items);
  const detail = processingDetail(getSelectedDeliveryOption());
  document.querySelectorAll("[data-order-processing-notice], [data-checkout-processing-notice]").forEach((notice) => {
    notice.hidden = !physical;
    const detailNode = notice.querySelector("[data-order-processing-detail], [data-checkout-processing-detail]");
    if (detailNode) detailNode.textContent = detail;
  });
};

const renderConfirmationProcessingNotice = () => {
  const notice = document.querySelector("[data-confirmation-processing-notice]");
  const summary = document.querySelector("[data-confirmation-delivery-summary]");
  if (!notice && !summary) return;
  let fulfilment = null;
  try { fulfilment = JSON.parse(sessionStorage.getItem(CHECKOUT_FULFILMENT_KEY) || "null"); } catch { fulfilment = null; }
  if (notice) notice.hidden = !fulfilment?.physical;
  const detail = notice?.querySelector("[data-confirmation-processing-detail]");
  if (detail && fulfilment?.physical) detail.textContent = processingDetail(fulfilment.deliveryOption);
  if (summary && fulfilment?.deliveryLabel) {
    summary.hidden = false;
    summary.textContent = `Delivery method: ${fulfilment.deliveryLabel} · Delivery: ${formatCurrency(fulfilment.deliveryFee)}`;
  }
  sessionStorage.removeItem(CHECKOUT_FULFILMENT_KEY);
};

const qualifyingProductSubtotal = (subtotal) => Math.max(0, subtotal - (Number(appliedPromo.productDiscount) || 0));
const qualifiesForFreeDelivery = (subtotal, deliveryOption = getSelectedDeliveryOption()) => deliveryOption === "pudo"
  && qualifyingProductSubtotal(subtotal) >= deliverySettings.freeDeliveryThreshold;
const getDeliveryFee = (deliveryOption = getSelectedDeliveryOption(), subtotal = getCartTotals().amount) => deliveryOption === "pudo" && !qualifiesForFreeDelivery(subtotal, deliveryOption)
  ? deliverySettings.standardPudoFee
  : deliveryOption === DOOR_TO_DOOR_METHOD ? DOOR_TO_DOOR_FEE : 0;

const getOrderTotals = (items = getCart()) => {
  const cartTotals = getCartTotals(items);
  const deliveryOption = getSelectedDeliveryOption();
  const deliveryFee = getDeliveryFee(deliveryOption, cartTotals.amount);
  return {
    quantity: cartTotals.quantity,
    subtotal: cartTotals.amount,
    deliveryOption,
    discountAmount: appliedPromo.discountAmount || 0,
    deliveryFee: appliedPromo.deliveryFee == null ? deliveryFee : appliedPromo.deliveryFee,
    freeDeliveryApplied: qualifiesForFreeDelivery(cartTotals.amount, deliveryOption),
    qualifyingSubtotal: qualifyingProductSubtotal(cartTotals.amount),
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
    if (data.deliverySettings) deliverySettings = { ...DEFAULT_DELIVERY_SETTINGS, ...data.deliverySettings };
    appliedPromo = { code: data.promoCode, discountAmount: data.discountAmount, productDiscount: data.productDiscount || 0, deliveryFee: data.deliveryFee, total: data.total };
    localStorage.setItem(PROMO_KEY, data.promoCode);
    if (status) status.textContent = data.message;
  } catch (error) {
    appliedPromo = { code: "", discountAmount: 0, productDiscount: 0, deliveryFee: null, total: null };
    localStorage.removeItem(PROMO_KEY);
    if (status) status.textContent = error.message;
  }
  renderCart();
};

const removePromoCode = () => {
  appliedPromo = { code: "", discountAmount: 0, productDiscount: 0, deliveryFee: null, total: null };
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

  const collectionInput = detailsForm.querySelector("input[name='deliveryOption'][value='collection']");
  const pudoInput = detailsForm.querySelector("input[name='deliveryOption'][value='pudo']");
  document.querySelector("[data-collection-option]")?.toggleAttribute("hidden", !deliverySettings.collectionEnabled);
  document.querySelector("[data-delivery-note='collection']")?.toggleAttribute("hidden", !deliverySettings.collectionEnabled || getSelectedDeliveryOption() !== "collection");
  if (!deliverySettings.collectionEnabled && collectionInput?.checked && pudoInput) pudoInput.checked = true;
  const deliveryOption = getSelectedDeliveryOption();
  const requiresAddress = deliveryOption !== "collection";
  detailsForm.querySelectorAll("[data-address-field]").forEach((field) => {
    field.required = requiresAddress;
    const wrapper = field.closest("label");
    if (wrapper) wrapper.hidden = !requiresAddress;
    if (!requiresAddress) {
      field.removeAttribute("aria-invalid");
      const error = detailsForm.querySelector(`[data-checkout-error='${field.name}']`);
      if (error) error.textContent = "";
    }
  });
  detailsForm.querySelector("[data-address-section]")?.toggleAttribute("hidden", !requiresAddress);
  document.querySelectorAll("[data-delivery-note]").forEach((note) => {
    note.hidden = note.dataset.deliveryNote !== deliveryOption;
  });
};

const checkoutFieldError = (form, field, message = "") => {
  field.setAttribute("aria-invalid", String(Boolean(message)));
  const error = form.querySelector(`[data-checkout-error='${field.name}']`);
  if (error) error.textContent = message;
};

const validateCheckoutDetails = (form, deliveryOption) => {
  const requiredNames = ["name", "email", "phone", ...(deliveryOption === "collection" ? [] : ["streetAddress", "suburb", "city", "province", "postalCode"])];
  const labels = { name: "Full name", email: "Email address", phone: "Mobile number", streetAddress: "Street address", suburb: "Suburb", city: "City or town", province: "Province", postalCode: "Postal code" };
  let firstInvalid = null;

  form.querySelectorAll("input[name]").forEach((field) => checkoutFieldError(form, field));
  requiredNames.forEach((name) => {
    const field = form.elements.namedItem(name);
    if (!(field instanceof HTMLInputElement)) return;
    const value = field.value.trim();
    let message = value ? "" : `${labels[name]} is required.`;
    if (!message && name === "email" && (!field.validity.valid || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) message = "Enter a valid email address.";
    if (!message && name === "phone" && value.replace(/\D/g, "").length < 7) message = "Enter a usable mobile number.";
    checkoutFieldError(form, field, message);
    if (message && !firstInvalid) firstInvalid = field;
  });

  firstInvalid?.focus();
  return !firstInvalid;
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

  const formData = new FormData(detailsForm);
  const selectedDeliveryOption = formData.get("deliveryOption")?.toString() || "collection";
  const deliveryOption = SUPPORTED_DELIVERY_METHODS.has(selectedDeliveryOption) ? selectedDeliveryOption : "collection";
  if (!validateCheckoutDetails(detailsForm, deliveryOption)) return null;
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
      label: deliveryOption === "pudo" ? "Pudo Locker Delivery" : deliveryOption === DOOR_TO_DOOR_METHOD ? "Door-to-Door Delivery" : "Collect from Lullubelle – Centurion",
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

  if (checkoutDetails.delivery.option !== "collection") {
    const missingAddressFields = Object.entries(checkoutDetails.address)
      .filter(([, value]) => !value)
      .map(([key]) => key);
    if (missingAddressFields.length) {
      if (status) {
        status.textContent = `Please complete the delivery address fields for ${checkoutDetails.delivery.label}.`;
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
  const paymentAttemptStorageKey = "lullubelle_ikhokha_payment_attempt";
  let paymentAttemptId = sessionStorage.getItem(paymentAttemptStorageKey);
  if (!paymentAttemptId) {
    paymentAttemptId = globalThis.crypto?.randomUUID?.() || `attempt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(paymentAttemptStorageKey, paymentAttemptId);
  }

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
        paymentAttemptId,
      }),
    });
    const data = await readCheckoutResponse(response);
    if (!response.ok || !data.paymentUrl || !data.orderNumber) {
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
    sessionStorage.setItem(CHECKOUT_FULFILMENT_KEY, JSON.stringify({
      physical: requiresPhysicalFulfilment(items),
      deliveryOption: delivery.option,
      deliveryLabel: delivery.label,
      deliveryFee: totals.deliveryFee,
    }));
    sessionStorage.removeItem(paymentAttemptStorageKey);
    clearCart();
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
  const freeDeliveryMessage = document.querySelector("[data-free-delivery-message]");

  if (!container) {
    return;
  }

  const items = getCart();
  updateDeliveryUi();
  updateOrderProcessingNotices(items);
  const totals = getOrderTotals(items);

  container.innerHTML = "";
  emptyState.hidden = items.length > 0;

  items.forEach((item) => {
    const row = document.createElement("article");
    row.className = "cart-item";
    row.innerHTML = `
      <img src="${escapeHtml(item.image || "lullubelle-logo.jpg")}" alt="${escapeHtml(item.name)}" width="88" height="88" loading="lazy" decoding="async">
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
    summaryDelivery.textContent = totals.freeDeliveryApplied ? "FREE" : formatCurrency(totals.deliveryFee);
  }
  if (summaryDiscount) summaryDiscount.textContent = totals.discountAmount ? `-${formatCurrency(totals.discountAmount)}` : formatCurrency(0);
  if (summaryTotal) {
    summaryTotal.textContent = formatCurrency(totals.finalTotal);
  }
  const pudoFee = document.querySelector("[data-pudo-fee]");
  if (pudoFee) pudoFee.textContent = totals.qualifyingSubtotal >= deliverySettings.freeDeliveryThreshold ? "FREE" : formatCurrency(deliverySettings.standardPudoFee);
  if (freeDeliveryMessage) {
    const remaining = Math.max(0, deliverySettings.freeDeliveryThreshold - totals.qualifyingSubtotal);
    freeDeliveryMessage.textContent = totals.qualifyingSubtotal >= deliverySettings.freeDeliveryThreshold
      ? "🎉 Your order qualifies for FREE PUDO delivery."
      : `Spend ${formatCurrency(remaining)} more to qualify for FREE PUDO delivery.`;
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

document.addEventListener("input", (event) => {
  const field = event.target instanceof HTMLInputElement ? event.target : null;
  const form = field?.closest("[data-checkout-details]");
  if (field && form && field.getAttribute("aria-invalid") === "true") checkoutFieldError(form, field);
});

updateCartCount();
renderCart();
renderConfirmationProcessingNotice();
if (document.querySelector("[data-cart-page]")) {
  loadManagedContent().then((content) => {
    deliverySettings = { ...DEFAULT_DELIVERY_SETTINGS, ...(content.deliverySettings || {}) };
    updateDeliveryUi();
    renderCart();
  });
}
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
injectFooterTrustSection();
injectLegalFooterLinks();
loadManagedContent()
  .then((content) => {
    applyManagedContent(content);
  })
  .finally(() => {
    setupResultsFilters();
    setupResultLightbox();
    setupPageStructuredData();
    renderProductDetailPage();
  });
window.addEventListener("popstate", () => renderProductDetailPage());
