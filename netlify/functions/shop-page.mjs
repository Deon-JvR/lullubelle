import { publicProduct, brandsFor, brandSlug, productCard, bootstrap } from "./_public-catalogue.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectBlobContext, readContent } from "./_admin-shared.mjs";
import { PRODUCT_CATEGORIES } from "./_products.mjs";
import { htmlSecurityHeaders, mergeSecurityHeaders } from "./lib/security-headers.mjs";

const SITE_URL = "https://www.lullubelle.co.za";
const template = readFileSync(resolve(process.cwd(), "shop.html"), "utf8");
const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
const replaceMeta = (html, attribute, key, value) => html.replace(new RegExp(`(<meta\\s+${attribute}="${key}"\\s+content=")[^"]*(")`, "i"), `$1${escapeHtml(value)}$2`);

export const categorySeo = (category) => ({
  title: `${category} Skincare Products | Lullubelle`,
  description: `Browse Lullubelle products assigned to the ${category} category. Compare available brands and open each product for its current details.`,
  canonical: `${SITE_URL}/shop?category=${encodeURIComponent(category)}`,
});

export const renderShopHtml = (content, requestedCategory, requestedBrand = "", query = "") => {
  const category = PRODUCT_CATEGORIES.includes(String(requestedCategory || "")) ? String(requestedCategory) : "";
  const brands = brandsFor(content);
  const brand = brands.find(b => brandSlug(b) === requestedBrand || b.id.toLowerCase() === requestedBrand.toLowerCase() || b.name.toLowerCase() === requestedBrand.toLowerCase());
  const seo = category ? categorySeo(category) : brand ? { title: `${brand.name} Skincare Products | Lullubelle`, description: `Browse the current ${brand.name} range at Lullubelle Beauty Specialist in Centurion. View product details and current catalogue prices.`, canonical: `${SITE_URL}/shop/${brandSlug(brand)}` } : { title: "Shop Skin Products | Lullubelle Beauty Specialist Centurion", description: "Browse current skincare products available through Lullubelle. View brands, product details and current catalogue prices.", canonical: `${SITE_URL}/shop` };
  if (brand && category) seo.canonical = `${SITE_URL}/shop/${brandSlug(brand)}`;
  let html = template
    .replace(/(<title>)[\s\S]*?(<\/title>)/i, `$1${escapeHtml(seo.title)}$2`)
    .replace(/(<link\s+rel="canonical"\s+href=")[^"]*(")/i, `$1${escapeHtml(seo.canonical)}$2`);
  html = replaceMeta(html, "name", "description", seo.description);
  html = replaceMeta(html, "property", "og:title", seo.title);
  html = replaceMeta(html, "property", "og:description", seo.description);
  html = replaceMeta(html, "property", "og:url", seo.canonical);
  html = replaceMeta(html, "name", "twitter:title", seo.title);
  html = replaceMeta(html, "name", "twitter:description", seo.description);
  html = html.replace("<h1>Invest in your skin.</h1>", `<h1>${category ? escapeHtml(category) + " skincare products" : brand ? escapeHtml(brand.name) + " products" : "Invest in your skin."}</h1>`)
    .replace("<p class=\"lead\">Choose a professional skincare range for your home-care routine.</p>", `<p class="lead">${escapeHtml(seo.description)}</p>`);
  const displayBrand = brand || (!requestedCategory && !query ? brands[0] : null);
  const products = (content.products || []).filter(p => publicProduct(p) && (!category || p.categories?.includes(category)) && (!displayBrand || p.brandId === displayBrand.id || p.brand === displayBrand.name) && (!query || `${p.name} ${p.brand} ${p.sku || ""}`.toLowerCase().includes(query.toLowerCase())));
  html = html.replace(/<section[^>]*data-brand-panel[^>]*>[\s\S]*?<\/section>/g, "");
  html = html.replace(/(<div class="supplier-tabs"[^>]*>)[\s\S]*?(<\/div>)/, `$1${brands.map(b => `<a class="supplier-tab${brand?.id === b.id ? " is-active" : ""}" href="/shop/${brandSlug(b)}">${escapeHtml(b.name)}</a>`).join("")}$2`);
  const archive = `<section class="section product-price-section" data-shop-catalogue><div class="section-heading" data-shop-catalogue-heading><p class="eyebrow">Product catalogue</p><h2>${escapeHtml(displayBrand ? displayBrand.name : category || "All")} products</h2><p>${escapeHtml(seo.description)}</p></div><div class="shop-catalogue-tools"><label>Search products<input type="search" value="${escapeHtml(query)}" placeholder="Search by product, SKU or keyword" data-shop-product-search></label><label>Category<select data-shop-category><option value="all">All categories</option>${PRODUCT_CATEGORIES.map(c=>`<option value="${escapeHtml(c)}"${c===category?' selected':''}>${escapeHtml(c)}</option>`).join('')}</select></label></div><p class="shop-catalogue-status" aria-live="polite" data-shop-catalogue-status>Showing ${products.length} of ${(content.products || []).filter(publicProduct).length} active products</p><div class="kalahari-grid" aria-live="polite" data-shop-product-grid>${products.map(productCard).join("")}</div><div class="stock-note"><p>Product availability can change. Lullubelle will confirm stock before completing your order.</p></div></section>`;
  html = html.replace(/(<section class="section payments-section)/, `${archive}$1`);
  if (!html.includes("data-shop-catalogue")) html = html.replace("</main>", `${archive}</main>`);
  if (query || (brand && category)) html = html.replace(/(<meta\s+name="robots"\s+content=")[^"]*(")/,'$1noindex,follow$2');
  const breadcrumb = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
    { "@type": "ListItem", position: 2, name: "Shop", item: `${SITE_URL}/shop` },
    { "@type": "ListItem", position: 3, name: brand?.name || category || "Products", item: seo.canonical },
  ] };
  const collection={"@context":"https://schema.org","@type":"CollectionPage",url:seo.canonical,name:seo.title,description:seo.description,...(brand && brand.id !== "new-brand" ? {about:{"@type":"Brand",name:brand.name}} : {}),mainEntity:{"@type":"ItemList",itemListElement:products.map((p,i)=>({"@type":"ListItem",position:i+1,url:`${SITE_URL}/products/${encodeURIComponent(p.slug || p.id)}`}))}};
  html=html.replace("</head>", `<script type="application/ld+json" data-server-collection>${safeJson(collection)}</script></head>`);
  return html.replace("</head>", `${bootstrap(content)}<script type="application/ld+json" data-server-category-breadcrumb>${safeJson(breadcrumb)}</script></head>`);
};

export const shopResponse = (event, content) => {
  const pathBrand = String(event.path || "").match(/\/shop\/([^/?#]+)/)?.[1] || "";
  if (pathBrand && !brandsFor(content).some(b => brandSlug(b) === pathBrand)) return { statusCode: 404, body: "<title>Brand not found | Lullubelle</title><h1>Brand not found</h1>" };
  return {
    statusCode: 200,
    headers: mergeSecurityHeaders({ "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "public, max-age=0, must-revalidate" }, htmlSecurityHeaders),
    body: renderShopHtml(content, event.queryStringParameters?.category, pathBrand || event.queryStringParameters?.brand || "", event.queryStringParameters?.q || ""),
  };
};

export const handler = async event => { connectBlobContext(event); try { return shopResponse(event, await readContent()); } catch { return {statusCode:503,headers:{"Content-Type":"text/html; charset=UTF-8","Retry-After":"60"},body:"<h1>Catalogue temporarily unavailable</h1>"}; } };
