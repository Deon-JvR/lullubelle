// Shared catalogue card markup preserves the accepted layout before and after enhancement.
(function(){
 const escapeHtml=(v="")=>String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
 const slugify=v=>String(v).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
 const formatCurrency=v=>`R${Number(v).toFixed(2)}`;
 const productDetailUrl=slug=>`/products/${encodeURIComponent(slug)}`;
 const stockLabel=status=>/out/i.test(status||"")?"Out of stock":/coming|pre.?order/i.test(status||"")?"Coming soon":"In stock";
 const isPurchasable=p=>p.hidden!==true&&p.active!==false&&p.published!==false&&Number(p.price)>0&&stockLabel(p.stockStatus)==="In stock";
globalThis.LullubelleCatalogueCard = (raw, index = 0) => {
  const product={...raw,slug:raw.slug || raw.id,sku:raw.sku || raw.id,categories:raw.categories || [],imageAlt:raw.imageAlt || `${raw.brand} ${raw.name}`};
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

globalThis.LullubelleFeaturedCard = (raw,index=0)=>{const product={...raw,slug:raw.slug || raw.id,imageAlt:raw.imageAlt || `${raw.brand} ${raw.name}`};return `
    <article class="product-card featured-product-card home-product-card">
      <a class="product-card__image-wrap featured-product-image" href="${escapeHtml(productDetailUrl(product.slug))}" aria-label="View ${escapeHtml(product.brand)} ${escapeHtml(product.name)}">
        ${product.bestSeller ? '<span class="product-status-badge">Best Seller</span>' : product.featured ? '<span class="product-status-badge">Featured</span>' : ""}
        <img class="product-card__image" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.imageAlt)}" width="650" height="650" decoding="async" loading="lazy">
      </a>
      <div class="product-card__content">
        <span class="product-brand-badge" data-brand="${escapeHtml(product.brand.toLowerCase())}">${escapeHtml(product.brand)}</span>
        <h3 class="product-card__title" title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</h3>
        <strong class="product-card__price">${formatCurrency(product.price)}</strong>
        <p class="product-description">${escapeHtml(product.benefit)}</p>
        <div class="product-card__actions featured-product-actions">
          <button class="button secondary" type="button" data-managed-cart-add data-product-id="${escapeHtml(product.id)}" data-product-name="${escapeHtml(product.brand)} ${escapeHtml(product.name)}" data-product-price="${Number(product.price)}" data-product-image="${escapeHtml(product.image)}"${isPurchasable(product) ? "" : " disabled"}>${isPurchasable(product) ? "Add to Cart" : escapeHtml(stockLabel(product.stockStatus))}</button>
          <a class="text-link" href="${escapeHtml(productDetailUrl(product.slug))}">View Product</a>
        </div>
      </div>
    </article>`;};
})();
