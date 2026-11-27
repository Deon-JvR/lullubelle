import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectBlobContext, readContent } from "./_admin-shared.mjs";
import { sanitiseGallery } from "./_gallery.mjs";
import { escapeHtml as e, safeJson, bootstrap, publicProduct, productCard, featuredCard, brandsFor, brandSlug, moneyLabel, SITE_URL, shippingServices } from "./_public-catalogue.mjs";
import { htmlSecurityHeaders, mergeSecurityHeaders } from "./lib/security-headers.mjs";
export const LEGACY_PRODUCT_IDS = Object.freeze({ "kalahari-nourishing-eye-balm":"kalahari-nourishing-eye-balm-tube" });
const files = { "/":"index.html", "/index.html":"index.html", "/pricelist":"pricelist.html", "/pricelist.html":"pricelist.html", "/before-after":"before-after/index.html", "/before-after/":"before-after/index.html", "/before-after/index.html":"before-after/index.html", "/skin-care-essentials":"skin-care-essentials.html", "/skin-care-essentials.html":"skin-care-essentials.html", "/cart":"cart.html", "/cart.html":"cart.html", "/shipping-policy":"shipping-policy.html", "/shipping-policy.html":"shipping-policy.html" };
const galleryCard = (g) => `<article class="result-card" data-results-card data-results-categories="${e(g.categories)}"><div class="result-feature-media"><button class="result-lightbox-trigger" type="button" data-lightbox-image="${e(g.image)}" data-lightbox-alt="${e(g.title)}" data-lightbox-title="${e(g.title)}" aria-label="Enlarge ${e(g.title)}"><img src="${e(g.image)}" alt="${e(g.title)}" width="1200" height="1200" loading="lazy" decoding="async"></button>${g.featured?'<span class="result-badge">Featured result</span>':''}</div><div class="result-card-content"><p class="eyebrow">${e(g.category)}</p><h2>${e(g.title)}</h2><p>${e(g.description)}</p>${g.treatments?`<p><strong>${e(g.treatments)}</strong></p>`:''}<a class="button primary" href="/book-appointment">Book Appointment</a></div></article>`;
export const renderContentPage = (path, content) => {
  const file = files[path];
  if (!file) return null;
  let homeFeaturedIds=[];
  let html = readFileSync(resolve(process.cwd(), file), "utf8");
  if (file === "pricelist.html") {
    const treatments = (content.treatments || []).filter(t => t.hidden !== true && t.active !== false && t.published !== false);
    const categories = [...new Set(treatments.map(t=>t.category || "Treatments"))];
    const rows = categories.map(category => {
      const items=treatments.filter(t=>(t.category || "Treatments") === category);
      const groups=[...new Set(items.map(t=>t.group || ""))];
      const heading = category === "Dermaplaning" ? `<a href="/dermaplaning-centurion">${e(category)}</a>` : e(category);
      return `<article class="treatment-menu-card${items.length>=8?' treatment-menu-card--wide':''}" id="category-${category.toLowerCase().replace(/[^a-z0-9]+/g,'-')}" data-service-category="${e(category)}"><h2 class="treatment-heading">${heading}</h2>${groups.map(group=>`${group?`<h3 class="treatment-subgroup">${e(group)}</h3>`:''}<ul class="treatment-list simple-list">${items.filter(t=>(t.group || '')===group).map(t=>`<li data-service-id="${e(t.id)}"><span class="treatment-copy"><strong>${e(t.name)}</strong>${t.duration && t.duration !== t.name?`<small class="treatment-duration">${e(t.duration)}</small>`:''}${t.description?`<small class="treatment-description">${e(t.description)}</small>`:''}</span><b class="treatment-price">${e(t.price || 'Confirm')}</b></li>`).join('')}</ul>`).join('')}</article>`;
    }).join('');
    html=html.replace(/(<div class="treatment-menu-grid"[^>]*>)[\s\S]*?(<\/div>)/,`$1${rows}$2`);
    const schema={"@context":"https://schema.org","@type":"OfferCatalog","@id":`${SITE_URL}/pricelist#pricelist`,name:"Lullubelle Beauty Specialist treatment pricelist",url:`${SITE_URL}/pricelist`,itemListElement:treatments.filter(t=>/^R\s*[\d,.]+$/.test(t.price || '')).map(t=>({"@type":"Offer",name:[t.category,t.group,t.name].filter(Boolean).join(' — '),priceCurrency:"ZAR",price:Number(t.price.replace(/[^\d.]/g,'')),itemOffered:{"@type":"Service",name:t.name,provider:{"@id":`${SITE_URL}/#business`}}}))};
    html=html.replace(/(<script[^>]*data-service-catalogue-schema[^>]*>)[\s\S]*?(<\/script>)/,`$1${safeJson(schema)}$2`);
  }
  if (file === "before-after/index.html") html=html.replace(/(<div class="results-grid"[^>]*>)[\s\S]*?(<\/div>)/,`$1${sanitiseGallery(content.gallery,{publicOnly:true}).map(galleryCard).join('')}$2`);
  if (file === "skin-care-essentials.html") {
    html=html.replace(/<tr>[\s\S]*?data-cart-add[\s\S]*?<\/tr>/g, row=>{
      const oldId=row.match(/data-product-id="([^"]+)"/)?.[1];
      const p=(content.products || []).find(p=>p.id===(LEGACY_PRODUCT_IDS[oldId] || oldId) && publicProduct(p));
      if (!p) return row.replace(/<button[\s\S]*?<\/button>/,'<a href="/book-appointment">Enquire about availability</a>');
      return `<tr><td><a href="/products/${encodeURIComponent(p.slug || p.id)}">${e(p.name)}</a></td><td>${moneyLabel(p.price)}</td><td><button class="button secondary" type="button" data-cart-add data-product-id="${e(p.id)}" data-product-name="${e(`${p.brand} ${p.name}`)}" data-product-price="${Number(p.price)}" data-product-image="${e(p.image)}">Add to cart</button></td></tr>`;
    });
    const selected=(content.products || []).filter(p=>publicProduct(p)&&p.brandId==='kalahari');
    html=html.replace('From R72',`From ${moneyLabel(Math.min(...selected.map(p=>Number(p.price))))}`);
    // This page is a collection; do not present its old range-price as one product offer.
    html=html.replace(/(<script[^>]*type="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/g, (all,open,text,close)=>{
      const data=JSON.parse(text);const walk=x=>{if(Array.isArray(x))x.forEach(walk);else if(x&&typeof x==='object'){if(x['@type']==='Product'){x['@type']='CollectionPage';delete x.offers;delete x.sku;delete x.brand;}Object.values(x).forEach(walk);}};walk(data);return open+safeJson(data)+close;
    });
  }
  if (file === "index.html") {
    const products=(content.products || []).filter(publicProduct);const featured=products.filter(p=>p.featured || p.bestSeller);
    const ordered=[...(content.brands || [])].sort((a,b)=>Number(a.order)-Number(b.order)).flatMap(b=>featured.filter(p=>p.brandId===b.id).slice(0,2));
    const ids=new Set(ordered.map(p=>p.id));const selected=[...ordered,...featured.filter(p=>!ids.has(p.id))].slice(0,8);
    homeFeaturedIds=selected.map(p=>p.id);
    const cards=selected.map(featuredCard).join("");
    html=html.replace(/(<div[^>]*data-featured-products[^>]*>)[\s\S]*?(<\/div>)/,`$1${cards}$2`);
    html=html.replace(/(<div[^>]*data-shop-brands[^>]*>)[\s\S]*?(<\/div>)/,`$1${brandsFor(content).map(b=>`<a class="shop-brand-card" href="/shop/${brandSlug(b)}"><span>${e(b.name)}</span><small>${e(b.description || 'Browse current products')}</small></a>`).join('')}$2`);
    html=html.replace(/(<div class="results-grid home-results-grid">)[\s\S]*?(<\/div>)/,`$1${sanitiseGallery(content.gallery,{publicOnly:true}).filter(g=>g.featured).slice(0,3).map(g=>`<a class="result-card home-result-card" href="/before-after/"><div class="home-result-image"><img src="${e(g.image)}" alt="${e(g.title)}" width="1200" height="750" loading="lazy" decoding="async"></div><div class="result-card-content"><p class="eyebrow">${e(g.category)}</p><h3>${e(g.title)}</h3></div></a>`).join('')}$2`);
  }
  if (file === "shipping-policy.html") {
    const business=JSON.parse(readFileSync("index.html","utf8").match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1]);
    const schema={...business,"@type":[...new Set([...(Array.isArray(business["@type"])?business["@type"]:[business["@type"]]),"Organization"])],hasShippingService:shippingServices(content.deliverySettings)};
    html=html.replace("</head>",`<script type="application/ld+json" data-merchant-shipping-policy>${safeJson(schema)}</script></head>`);
    const settings = content.deliverySettings;
    const offer = settings.freeDeliveryThreshold > 0
      ? ` Free PUDO delivery applies from ${moneyLabel(settings.freeDeliveryThreshold)} after discounts.` : "";
    html = html.replace("<h2>Shipping Costs</h2>", `<h2>Shipping Costs</h2><p>PUDO locker delivery: ${moneyLabel(settings.standardPudoFee)}.${offer} ${settings.collectionEnabled ? "Collection from Lullubelle is free." : "Collection is currently unavailable."}</p>`);
  }
  if (file === "cart.html") {
    const fee=content.deliverySettings?.standardPudoFee;
    if (fee !== undefined) html=html.replace(/(<strong data-pudo-fee>)[^<]*/, `$1${moneyLabel(fee)}`);
  }
  const initialData = bootstrap(content, {ids:homeFeaturedIds,mode:file === "index.html" ? "home" : file === "pricelist.html" ? "pricelist" : file === "before-after/index.html" ? "gallery" : file === "cart.html" ? "cart" : file === "shipping-policy.html" ? "policy" : "legacy"});
  // Deferred scripts execute after parsing, so the homepage data can follow its content.
  return file === "index.html" ? html.replace('</body>', `${initialData}</body>`) : html.replace('</head>', `${initialData}</head>`);
};
export const handler = async event => {
  connectBlobContext(event);
  let html;
  try { html=renderContentPage(event.path,await readContent()); } catch { return {statusCode:503,headers:{"Content-Type":"text/html; charset=UTF-8","Retry-After":"60"},body:"<h1>Catalogue temporarily unavailable</h1>"}; }
  return {statusCode:html?200:404,headers:mergeSecurityHeaders({"Content-Type":"text/html; charset=UTF-8","Cache-Control":"public, max-age=0, must-revalidate"},htmlSecurityHeaders),body:html || '<h1>Page not found</h1>'};
};
