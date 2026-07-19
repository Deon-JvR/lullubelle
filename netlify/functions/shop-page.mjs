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

export const renderShopHtml = (content, requestedCategory) => {
  const category = PRODUCT_CATEGORIES.includes(String(requestedCategory || "")) ? String(requestedCategory) : "";
  if (!category) return template;
  const seo = categorySeo(category);
  let html = template
    .replace(/(<title>)[\s\S]*?(<\/title>)/i, `$1${escapeHtml(seo.title)}$2`)
    .replace(/(<link\s+rel="canonical"\s+href=")[^"]*(")/i, `$1${escapeHtml(seo.canonical)}$2`);
  html = replaceMeta(html, "name", "description", seo.description);
  html = replaceMeta(html, "property", "og:title", seo.title);
  html = replaceMeta(html, "property", "og:description", seo.description);
  html = replaceMeta(html, "property", "og:url", seo.canonical);
  html = replaceMeta(html, "name", "twitter:title", seo.title);
  html = replaceMeta(html, "name", "twitter:description", seo.description);
  html = html.replace("<h1>Invest in your skin.</h1>", `<h1>${escapeHtml(category)} skincare products</h1>`)
    .replace("<p class=\"lead\">Choose a professional skincare range for your home-care routine.</p>", `<p class="lead">${escapeHtml(seo.description)}</p>`);
  const products = (content.products || []).filter((product) => product.hidden !== true && product.active !== false && product.published !== false && product.categories?.includes(category));
  const links = products.map((product) => `<li><a href="/products/${encodeURIComponent(product.slug || product.id)}">${escapeHtml(product.brand)} ${escapeHtml(product.name)}</a></li>`).join("");
  const archive = `<section class="section" data-server-category-products><h2>${escapeHtml(category)} product catalogue</h2><p>${escapeHtml(seo.description)}</p><ul>${links}</ul></section>`;
  html = html.replace("</main>", `${archive}</main>`);
  const breadcrumb = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
    { "@type": "ListItem", position: 2, name: "Shop", item: `${SITE_URL}/shop` },
    { "@type": "ListItem", position: 3, name: category, item: seo.canonical },
  ] };
  return html.replace("</head>", `<script type="application/ld+json" data-server-category-breadcrumb>${safeJson(breadcrumb)}</script></head>`);
};

export const handler = async (event) => {
  connectBlobContext(event);
  const content = await readContent();
  return {
    statusCode: 200,
    headers: mergeSecurityHeaders({ "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "public, max-age=0, must-revalidate" }, htmlSecurityHeaders),
    body: renderShopHtml(content, event.queryStringParameters?.category),
  };
};
