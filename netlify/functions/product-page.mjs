import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectBlobContext, readContent } from "./_admin-shared.mjs";

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

export const renderProductHtml = (product) => {
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
  return html;
};

export const handler = async (event) => {
  connectBlobContext(event);
  const content = await readContent();
  const slug = decodeURIComponent(String(event.path || "").match(/\/products\/([^/?#]+)/)?.[1] || "");
  const product = (content.products || []).find((item) => (item.slug || item.id) === slug && item.hidden !== true && item.active !== false && item.published !== false);

  if (!product) {
    return {
      statusCode: 404,
      headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "public, max-age=0, must-revalidate" },
      body: "<!doctype html><title>Product not found | Lullubelle</title><h1>Product not found</h1>",
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "public, max-age=0, must-revalidate" },
    body: renderProductHtml(product),
  };
};
