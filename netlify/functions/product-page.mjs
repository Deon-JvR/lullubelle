import { genuineProductImage } from "./_product-image-reconciliation.mjs";
import { LEGACY_PRODUCT_IDS } from "./content-page.mjs";
import "../../public/product-markup.js";
import { publicProduct, saleProduct, shippingDetails, bootstrap, brandSlug, productCard } from "./_public-catalogue.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectBlobContext, readContent } from "./_admin-shared.mjs";
import { htmlSecurityHeaders, mergeSecurityHeaders } from "./lib/security-headers.mjs";

const SITE_URL = "https://www.lullubelle.co.za";
const template = readFileSync(resolve(process.cwd(), "product.html"), "utf8");

const escapeAttribute = (value) => String(value)
  .replace(/&/g, "&amp;")
  .replace(/"/g, "&quot;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");

const replaceTagContent = (html, tag, value) => html.replace(
  new RegExp(`(<${tag}[^>]*>)[\\s\\S]*?(</${tag}>)`, "i"),
  `$1${escapeAttribute(value)}$2`,
);

const replaceMeta = (html, attribute, key, value) => html.replace(
  new RegExp(`(<meta\\s+${attribute}="${key}"\\s+content=")[^"]*(")`, "i"),
  `$1${escapeAttribute(value)}$2`,
);

const replaceCanonical = (html, value) => html.replace(
  /(<link\s+rel="canonical"\s+href=")[^"]*(")/i,
  `$1${escapeAttribute(value)}$2`,
);

const absoluteImageUrl = (image) => new URL(String(image || "lullubelle-logo.jpg").replace(/^\/+/, ""), `${SITE_URL}/`).href;

const escapeHtml = (value) => escapeAttribute(value).replace(/'/g, "&#39;");
const safeJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
const availabilityUrl = (stockStatus) => {
  if (/out/i.test(String(stockStatus || ""))) return "https://schema.org/OutOfStock";
  if (/coming|pre.?order/i.test(String(stockStatus || ""))) return "https://schema.org/PreOrder";
  return "https://schema.org/InStock";
};

export const productStructuredData = (product, canonical, deliverySettings) => ({
  "@context": "https://schema.org",
  "@type": "Product",
  name: product.name,
  description: product.description || product.benefit || product.seoDescription,
  image: [product.image, ...(product.galleryImages || []).map((item) => typeof item === "string" ? item : item.url)]
    .filter(genuineProductImage).map(absoluteImageUrl),
  sku: product.sku || product.id,
  brand: { "@type": "Brand", name: product.brand },
  category: (product.categories || []).join(", "),
  url: canonical,
  offers: {
    "@type": "Offer",
    url: canonical,
    priceCurrency: "ZAR",
    // Preserve the authoritative catalogue representation; never derive an
    // offer from a seed, display formatter or catalogue-wide default.
    price: product.price,
    availability: availabilityUrl(product.stockStatus),
    itemCondition: "https://schema.org/NewCondition",
    ...(deliverySettings ? { shippingDetails: shippingDetails(deliverySettings, product.price) } : {}),
  },
});

export const breadcrumbStructuredData = (product, canonical) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
    { "@type": "ListItem", position: 2, name: "Shop", item: `${SITE_URL}/shop` },
    { "@type": "ListItem", position: 3, name: product.name, item: canonical },
  ],
});

export const renderProductHtml = (product, content = {}) => {
  const slug = product.slug || product.id;
  const title = product.seoTitle || `${product.brand} ${product.name} | Lullubelle Skincare Centurion`;
  const description = product.seoDescription || `${product.brand} ${product.name} from Lullubelle Beauty Specialist in Centurion. View benefits, directions, skin suitability and order online.`;
  const canonical = `${SITE_URL}/products/${encodeURIComponent(slug)}`;
  const image = absoluteImageUrl(product.image);

  let html = replaceTagContent(template, "title", title);
  html = replaceMeta(html, "name", "description", description);
  html = replaceCanonical(html, canonical);
  html = replaceMeta(html, "property", "og:title", title);
  html = replaceMeta(html, "property", "og:description", description);
  html = replaceMeta(html, "property", "og:type", "product");
  html = replaceMeta(html, "property", "og:url", canonical);
  html = replaceMeta(html, "property", "og:image", image);
  html = replaceMeta(html, "name", "twitter:card", "summary_large_image");
  html = replaceMeta(html, "name", "twitter:title", title);
  html = replaceMeta(html, "name", "twitter:description", description);
  html = replaceMeta(html, "name", "twitter:image", image);
  const serverContent = globalThis.LullubelleProductMarkup(product, (content.products || []).filter(p => publicProduct(p) && p.id !== product.id && p.brand === product.brand).slice(0,3), content.deliverySettings);
  html = html.replace(/(<main\s+id="main-content"\s+data-product-detail>)[\s\S]*?(<\/main>)/i, `$1${serverContent}$2`);
  html = html.replace('data-product-detail>', `data-product-detail data-rendered-product="${escapeHtml(product.id)}">`);
  const schemas = `<script type="application/ld+json" data-server-product-schema>${safeJson(productStructuredData(product, canonical, content.deliverySettings))}</script><script type="application/ld+json" data-server-breadcrumb-schema>${safeJson(breadcrumbStructuredData(product, canonical))}</script>`;
  html = html.replace("</head>", `${schemas}${content.products ? bootstrap(content, {mode:"product", ids:[product.id, ...(content.products || []).filter(p => publicProduct(p) && p.id !== product.id && p.brand === product.brand).slice(0,3).map(p=>p.id)]}) : ""}</head>`);
  return html;
};

export const productResponse = (event, content) => {
  const pathSlug = String(event.path || "").match(/\/products\/([^/?#]+)/)?.[1];
  // A canonical path owns its identity, even when an old query survives a link.
  const lookup = pathSlug ? undefined : event.queryStringParameters?.product || event.queryStringParameters?.id;
  const legacy = LEGACY_PRODUCT_IDS[lookup] || lookup;
  const slug = legacy || decodeURIComponent(pathSlug || "");
  const product = (content.products || []).find((item) => ((item.slug || item.id) === slug || (legacy && item.id === slug)) && publicProduct(item));

  if (!product) {
    return {
      statusCode: 404,
      headers: mergeSecurityHeaders({ "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "public, max-age=0, must-revalidate" }, htmlSecurityHeaders),
      body: "<!doctype html><title>Product not found | Lullubelle</title><h1>Product not found</h1>",
    };
  }

  if (legacy) return { statusCode: 301, headers: { Location: `/products/${encodeURIComponent(product.slug || product.id)}`, "Cache-Control": "no-store" }, body: "" };

  return {
    statusCode: 200,
    headers: mergeSecurityHeaders({ "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "public, max-age=0, must-revalidate" }, htmlSecurityHeaders),
    body: renderProductHtml(product, content),
  };
};

export const handler = async event => { connectBlobContext(event); try { return productResponse(event, await readContent()); } catch { return {statusCode:503,headers:{"Content-Type":"text/html; charset=UTF-8","Retry-After":"60"},body:"<h1>Catalogue temporarily unavailable</h1>"}; } };
