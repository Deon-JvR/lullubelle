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
  const buttons = Array.from(scope.querySelectorAll("[data-cart-add], [data-featured-cart-add], [data-vitaderm-cart-add]"));
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
        url: `${window.location.origin}/shop?product=${encodeURIComponent(id)}`,
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

const setupVitaDermCatalogue = async () => {
  const grid = document.querySelector("[data-vitaderm-products]");
  if (!grid) return;

  try {
    const response = await fetch("products/vitaderm/catalogue.json?v=20260704b");
    if (!response.ok) throw new Error("Catalogue unavailable");
    const products = await response.json();

    grid.innerHTML = products.map((product) => {
      const slug = product.source_url.split("/").filter(Boolean).pop();
      const image = `products/vitaderm/${slug}.webp`;
      const description = product.description.replace(/^Description\s*/i, "");
      const benefit = (product.benefits || description).replace(/^Benefits?\s*/i, "");
      const summary = benefit.length > 105 ? `${benefit.slice(0, 102).trim().replace(/\s+\S*$/, "")}…` : benefit;
      const productId = `vitaderm-${slug}`;
      return `
        <article class="kalahari-item">
          ${product.manual_review ? "" : `<span class="product-status-badge">New</span>`}
          <div class="product-image-wrap"><img src="${escapeHtml(image)}" alt="VitaDerm ${escapeHtml(product.name)}" width="900" height="900" decoding="async" loading="lazy"></div>
          <span class="product-brand-badge" data-brand="vitaderm">VitaDerm</span>
          <h3>${escapeHtml(product.name)}</h3>
          <strong>${formatCurrency(Number(product.price))}</strong>
          ${product.size ? `<small>${escapeHtml(product.size)}</small>` : ""}
          <p>${escapeHtml(summary)}</p>
          <span class="product-stock"><span aria-hidden="true"></span> In stock</span>
          <div class="product-card-actions"><button class="button secondary" type="button" data-vitaderm-cart-add data-product-id="${escapeHtml(productId)}" data-product-name="VitaDerm ${escapeHtml(product.name)}" data-product-price="${Number(product.price)}" data-product-image="${escapeHtml(image)}">Add to cart</button><a class="text-link" href="${escapeHtml(productDetailUrl(productId))}">View Product</a></div>
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
    syncProductSchemas(grid);
  } catch {
    grid.innerHTML = "<p>VitaDerm products could not be loaded. Please contact Lullubelle for current availability.</p>";
  }
};

const enhanceStaticShopCards = () => {
  document.querySelectorAll(".shop-page .kalahari-item").forEach((card, index) => {
    const cartButton = card.querySelector("[data-product-id]");
    const productId = cartButton?.dataset.productId || `shop-product-${index + 1}`;
    const productName = cartButton?.dataset.productName || card.querySelector("h3")?.textContent || "Product";
    const brand = productName.split(" ")[0] || card.closest("[data-brand-panel]")?.dataset.brandPanel || "Lullubelle";
    if (!card.id) card.id = productId;
    if (!card.querySelector(".product-brand-badge")) {
      const badge = document.createElement("span");
      badge.className = "product-brand-badge";
      badge.dataset.brand = brand.toLowerCase();
      badge.textContent = brand;
      card.querySelector("h3")?.before(badge);
    }
    if (!card.querySelector(".product-status-badge") && (index === 0 || /Hydra-Vital Light/i.test(productName))) {
      const status = document.createElement("span");
      status.className = "product-status-badge";
      status.textContent = index === 0 ? "Best Seller" : "New";
      card.prepend(status);
    }
    if (!card.querySelector(".product-stock")) {
      const stock = document.createElement("span");
      stock.className = "product-stock";
      stock.innerHTML = '<span aria-hidden="true"></span> In stock';
      card.querySelector(".button")?.before(stock);
    }
    const directButton = card.querySelector(":scope > .button");
    if (directButton) {
      const actions = document.createElement("div");
      actions.className = "product-card-actions";
      directButton.before(actions);
      actions.append(directButton);
      const link = document.createElement("a");
      link.className = "text-link";
      link.href = productDetailUrl(productId);
      link.textContent = "View Product";
      link.setAttribute("aria-label", `View ${card.querySelector("h3")?.textContent || "product"}`);
      actions.append(link);
    }
  });
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
    const response = await fetch("products/featured-products.json?v=20260704b");
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
          ${product.badge ? `<span class="product-status-badge">${escapeHtml(product.badge)}</span>` : ""}
          <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.brand)} ${escapeHtml(product.name)}" width="650" height="650" decoding="async" loading="lazy">
        </a>
        <div>
          <span class="product-brand-badge" data-brand="${escapeHtml(product.brand.toLowerCase())}">${escapeHtml(product.brand)}</span>
          <h3>${escapeHtml(product.name)}</h3>
          <strong>${formatCurrency(Number(product.price))}</strong>
          <p>${escapeHtml(product.benefit || "Professional home care selected by Lullubelle.")}</p>
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
  } catch {
    grid.innerHTML = '<p>Featured products are temporarily unavailable. <a class="text-link" href="shop.html">Browse the full shop</a>.</p>';
  }
};

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

const SHOP_PRODUCT_DETAILS = [
  { id: "kalahari-facial-cleanser", brand: "Kalahari", name: "Facial Cleanser", price: 278, image: "products/kalahari-facial-cleanser.webp", benefit: "Everyday cleansing support for a fresh skin routine.", suitable: "Most skin types needing a simple daily cleanse.", directions: "Use morning and evening as the first step in your home-care routine.", ingredients: "Please confirm current ingredient list with Lullubelle before purchase." },
  { id: "kalahari-gentle-cleansing-milk", brand: "Kalahari", name: "Gentle Cleansing Milk", price: 291, image: "products/kalahari-facial-cleanser.webp", benefit: "Soft cleansing option for dry, sensitive, or delicate skin.", suitable: "Dry, delicate or sensitive-feeling skin.", directions: "Massage gently over the skin and remove with water or damp cotton pads.", ingredients: "Please confirm current ingredient list with Lullubelle before purchase." },
  { id: "kalahari-toning-lotion", brand: "Kalahari", name: "Toning Lotion", price: 347, image: "products/kalahari-toning-lotion.webp", benefit: "Refreshing toner step after cleansing.", suitable: "Skin needing a fresh second cleanse and toner step.", directions: "Apply after cleansing before serum or moisturiser.", ingredients: "Please confirm current ingredient list with Lullubelle before purchase." },
  { id: "kalahari-enzyme-face-buff", brand: "Kalahari", name: "Enzyme Face Buff", price: 362, image: "products/kalahari-enzyme-face-buff.webp", benefit: "Polishing exfoliation support for smoother-looking skin.", suitable: "Dull or rough-textured skin that tolerates exfoliation.", directions: "Use as advised by your skin therapist; avoid over-exfoliating.", ingredients: "Please confirm current ingredient list with Lullubelle before purchase." },
  { id: "kalahari-essential-daily-moisturiser", brand: "Kalahari", name: "Essential Daily Moisturiser", price: 405, image: "products/kalahari-essential-daily-moisturiser.webp", benefit: "Daily hydration for a simple home-care routine.", suitable: "Normal to dry skin needing daily moisture.", directions: "Apply after cleansing and serum. Use SPF during the day.", ingredients: "Please confirm current ingredient list with Lullubelle before purchase." },
  { id: "kalahari-hydralite-moisturiser", brand: "Kalahari", name: "Hydralite Moisturiser", price: 442, image: "products/kalahari-hydralite-moisturiser.webp", benefit: "Lightweight moisture support for dehydrated skin.", suitable: "Dehydrated skin that prefers a lighter moisturiser.", directions: "Apply morning and evening after serum.", ingredients: "Please confirm current ingredient list with Lullubelle before purchase." },
  { id: "kalahari-evening-moisturiser", brand: "Kalahari", name: "Evening Moisturiser", price: 431, image: "products/kalahari-essential-daily-moisturiser.webp", benefit: "Night-time comfort and hydration support.", suitable: "Skin needing a richer evening moisturising step.", directions: "Apply in the evening after cleansing and serum.", ingredients: "Please confirm current ingredient list with Lullubelle before purchase." },
  { id: "kalahari-phyto-rich-moisturiser", brand: "Kalahari", name: "Phyto Rich Moisturiser", price: 597, image: "products/kalahari-hydralite-moisturiser.webp", benefit: "Rich moisturising care for drier skin routines.", suitable: "Dry or mature-feeling skin needing richer comfort.", directions: "Apply after serum, especially as an evening moisturiser.", ingredients: "Please confirm current ingredient list with Lullubelle before purchase." },
  { id: "kalahari-spf-40-sun-protection", brand: "Kalahari", name: "SPF 40 Sun Protection", price: 457, image: "products/kalahari-spf-40-sun-protection.webp", benefit: "Daily UVA/UVB protection support.", suitable: "Daily daytime protection for most skin routines.", directions: "Apply every morning as the final skincare step. Reapply with sun exposure.", ingredients: "Please confirm current ingredient list with Lullubelle before purchase." },
  { id: "kalahari-solar-defence-fluid-50", brand: "Kalahari", name: "Solar Defence Fluid 50", price: 581, image: "products/kalahari-solar-defence-fluid-50.webp", benefit: "High-protection fluid for daytime use.", suitable: "Skin needing high daily sun protection.", directions: "Apply generously each morning and reapply when outdoors.", ingredients: "Please confirm current ingredient list with Lullubelle before purchase." },
  { id: "kalahari-nourishing-eye-balm", brand: "Kalahari", name: "Nourishing Eye Balm Tube", price: 291, image: "products/kalahari-nourishing-eye-balm.webp", benefit: "Eye-area care for a gentle finishing step.", suitable: "Dry or delicate-looking eye area.", directions: "Pat a small amount around the orbital area as advised.", ingredients: "Please confirm current ingredient list with Lullubelle before purchase." },
  { id: "kalahari-hydrating-collagen-eye-patches", brand: "Kalahari", name: "Hydrating Collagen Eye Patches", price: 72, image: "products/kalahari-nourishing-eye-balm.webp", benefit: "Quick eye-area hydration treatment patches.", suitable: "Tired or dehydrated-looking eye area.", directions: "Use as a short treatment step before moisturiser.", ingredients: "Please confirm current ingredient list with Lullubelle before purchase." },
  { id: "mesoestetic-hydra-vital-light", brand: "Mesoestetic", name: "Hydra-Vital Light", price: 2135, image: "products/mesoestetic/hydra-vital-light.webp", benefit: "Refreshing moisturising gel-cream for normal, combination and oily skin.", suitable: "Normal, combination and oily skin.", directions: "Apply after cleansing and serum as directed by your therapist.", ingredients: "Please confirm current ingredient list with Lullubelle before purchase." },
  { id: "mesoestetic-fast-skin-repair", brand: "Mesoestetic", name: "Fast Skin Repair", price: 1889, image: "products/mesoestetic/fast-skin-repair.webp", benefit: "Regenerative comfort cream for sensitive or sensitised skin.", suitable: "Sensitive, sensitised or barrier-stressed skin.", directions: "Apply as a comfort cream according to professional guidance.", ingredients: "Please confirm current ingredient list with Lullubelle before purchase." },
  { id: "mesoestetic-skin-balance", brand: "Mesoestetic", name: "Skin Balance", price: 2759, image: "products/mesoestetic/skin-balance.webp", benefit: "Intensive calming concentrate supporting sensitive and sensitised skin.", suitable: "Reactive, sensitive or sensitised skin.", directions: "Use as directed by your skin therapist.", ingredients: "Please confirm current ingredient list with Lullubelle before purchase." },
];

const productDetailUrl = (id) => `product.html?product=${encodeURIComponent(id)}`;

const normaliseVitaDermProduct = (product) => {
  const slug = product.source_url?.split("/").filter(Boolean).pop() || product.sku?.toLowerCase();
  return {
    id: `vitaderm-${slug}`,
    brand: "VitaDerm",
    name: product.name,
    price: Number(product.price) || 0,
    image: `products/vitaderm/${slug}.webp`,
    benefit: (product.benefits || product.description || "Professional VitaDerm skincare available from Lullubelle.").replace(/^Benefits?\s*/i, ""),
    description: (product.description || product.benefits || "").replace(/^Description\s*/i, ""),
    directions: product.directions || "Use as directed by your skin therapist.",
    ingredients: product.ingredients || "Ingredient list not published. Please confirm current ingredients with Lullubelle before purchase.",
    suitable: Array.isArray(product.categories) && product.categories.length ? product.categories.join(", ") : "Selected skin routines after consultation.",
    size: product.size || "",
    sku: product.sku || "",
  };
};

const getAllShopProducts = async () => {
  let vitaDermProducts = [];
  try {
    const response = await fetch("products/vitaderm/catalogue.json?v=20260704b");
    if (response.ok) {
      const products = await response.json();
      vitaDermProducts = Array.isArray(products) ? products.map(normaliseVitaDermProduct) : [];
    }
  } catch {
    vitaDermProducts = [];
  }
  return [...SHOP_PRODUCT_DETAILS, ...vitaDermProducts];
};

const renderProductDetailPage = async () => {
  const container = document.querySelector("[data-product-detail]");
  if (!container) return;

  const products = await getAllShopProducts();
  const requestedId = new URLSearchParams(window.location.search).get("product");
  const product = products.find((item) => item.id === requestedId) || products[0];
  const related = products
    .filter((item) => item.id !== product.id && item.brand === product.brand)
    .slice(0, 3);
  const description = product.description || product.benefit || `${product.brand} ${product.name} is available through Lullubelle Beauty Specialist in Centurion.`;

  document.title = `${product.brand} ${product.name} | Lullubelle Skincare Centurion`;
  document.querySelector('meta[name="description"]')?.setAttribute("content", `${product.brand} ${product.name} from Lullubelle Beauty Specialist in Centurion. View benefits, directions, skin suitability and order online.`);
  document.querySelector('link[rel="canonical"]')?.setAttribute("href", `https://www.lullubelle.co.za/product?product=${encodeURIComponent(product.id)}`);

  container.innerHTML = `
    <section class="section product-detail product-detail-page-hero">
      <div class="product-detail-media">
        <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.brand)} ${escapeHtml(product.name)}" width="900" height="900" decoding="async" loading="eager" fetchpriority="high">
      </div>
      <div class="product-detail-copy">
        <p class="eyebrow">${escapeHtml(product.brand)} skincare</p>
        <h1>${escapeHtml(product.name)}</h1>
        <strong>${formatCurrency(product.price)}</strong>
        ${product.size ? `<p class="product-size">${escapeHtml(product.size)}</p>` : ""}
        <p class="lead">${escapeHtml(product.benefit || description)}</p>
        <div class="product-buy-actions">
          <button class="button primary" type="button" data-product-detail-cart data-product-id="${escapeHtml(product.id)}" data-product-name="${escapeHtml(product.brand)} ${escapeHtml(product.name)}" data-product-price="${Number(product.price)}" data-product-image="${escapeHtml(product.image)}">Add to Cart</button>
          <a class="button secondary" href="shop?brand=${encodeURIComponent(product.brand)}">Back to ${escapeHtml(product.brand)}</a>
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
          <p>${escapeHtml(product.benefit || description)}</p>
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
      <div><span>✦</span><p><strong>Professional Brands</strong><small>Kalahari, VitaDerm &amp; Mesoestetic</small></p></div>
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

setupBrandFilters();
setupVitaDermCatalogue();
setupFeaturedProducts();
enhanceStaticShopCards();
setupResultsFilters();
setupResultLightbox();
setupPageStructuredData();
renderProductDetailPage();
injectFooterTrustSection();
