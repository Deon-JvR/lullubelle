// Shared product markup keeps server HTML and enhanced pages geometrically identical.
(function () {
  const escapeHtml = (v = "") => String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  const formatCurrency = v => `R${Number(v).toFixed(2)}`;
  const productDetailUrl = slug => `/products/${encodeURIComponent(slug)}`;
  const stockLabel = status => /out/i.test(status || "") ? "Out of stock" : /coming|pre.?order/i.test(status || "") ? "Coming soon" : "In stock";
  const isPurchasable = p => stockLabel(p.stockStatus) === "In stock";
  globalThis.LullubelleProductMarkup = (raw, related = [], deliverySettings) => {
    const product = {...raw, imageAlt:raw.imageAlt || `${raw.brand} ${raw.name}`, galleryImages: (raw.galleryImages || []).map(i => typeof i === "string" ? {url:i,alt:raw.name} : i), benefits:raw.benefits || [], storage:raw.storage || []};
    const description = product.description || product.benefit || `${product.brand} ${product.name} is available through Lullubelle Beauty Specialist in Centurion.`;
  return `
    <section class="section product-detail product-detail-page-hero">
      <div class="product-detail-media">
        <img class="product-detail-main-image" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.imageAlt)}" width="900" height="900" decoding="async" loading="eager" fetchpriority="high">
        ${product.galleryImages.length ? `<div class="product-detail-gallery" aria-label="Additional product images">${product.galleryImages.map((image) => `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}" width="320" height="320" decoding="async" loading="lazy">`).join("")}</div>` : ""}
      </div>
      <div class="product-detail-copy">
        <p class="eyebrow">${escapeHtml(product.brand)} skincare</p>
        <h1>${escapeHtml(product.name)}</h1>
        <strong>${formatCurrency(product.price)}</strong><p class="product-stock">${escapeHtml(stockLabel(product.stockStatus))}</p>
        ${product.size ? `<p class="product-size">${escapeHtml(product.size)}</p>` : ""}
        <p class="lead">${escapeHtml(product.benefit || description)}</p>
        ${product.categories?.length ? `<p>Categories: ${product.categories.map(c=>`<a href="/shop?category=${encodeURIComponent(c)}">${escapeHtml(c)}</a>`).join(", ")}</p>` : ""}<div class="product-buy-actions">
          <button class="button primary" type="button" data-product-detail-cart${isPurchasable(product) ? "" : " disabled"} data-product-id="${escapeHtml(product.id)}" data-product-name="${escapeHtml(product.brand)} ${escapeHtml(product.name)}" data-product-price="${Number(product.price)}" data-product-image="${escapeHtml(product.image)}">${isPurchasable(product) ? "Add to Cart" : escapeHtml(stockLabel(product.stockStatus))}</button>
          <a class="button secondary" href="/shop/${encodeURIComponent(product.brandId === "new-brand" ? "launch-bundles" : product.brandId)}">Back to ${escapeHtml(product.brand)}</a>
        </div>
        ${deliverySettings ? `<p class="product-shipping-summary">Collection at Lullubelle${deliverySettings.collectionEnabled === false ? " is unavailable" : " is free"}. PUDO locker delivery: ${formatCurrency(deliverySettings.standardPudoFee)}; free when the qualifying order subtotal reaches ${formatCurrency(deliverySettings.freeDeliveryThreshold)}. Door-to-door delivery: R80.00. <a href="/shipping-policy">Shipping policy</a> · <a href="/refund-policy">Refund policy</a>.</p>` : ""}
        <noscript><p><a href="https://wa.me/27825764219">Contact Lullubelle to order</a>. The online cart requires JavaScript.</p></noscript>
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
  };
})();
