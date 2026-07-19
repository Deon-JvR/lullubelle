#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error("Usage: node tools/audit-production-product-pages.mjs <production-content.json>");
const content = JSON.parse(await readFile(sourcePath, "utf8"));
const origin = "https://www.lullubelle.co.za";
const visible = content.products.filter((item) => item.hidden !== true && item.active !== false && item.published !== false);
const absolute = (value) => new URL(String(value || ""), `${origin}/`).href;

const mapLimit = async (items, concurrency, worker) => {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = await worker(items[index], index); }
      catch (error) { results[index] = { error: error.message }; }
    }
  }));
  return results;
};

const pageChecks = await mapLimit(visible, 10, async (product) => {
  const requestedUrl = `${origin}/products/${encodeURIComponent(product.slug || product.id)}`;
  const response = await fetch(requestedUrl, { redirect: "manual", headers: { "User-Agent": "Lullubelle-SEO-Audit/1.0" } });
  const html = await response.text();
  return {
    id: product.id,
    requestedUrl,
    status: response.status,
    location: response.headers.get("location"),
    title: html.match(/<title>(.*?)<\/title>/is)?.[1]?.trim() || "",
    description: html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1] || "",
    canonical: html.match(/<link\s+rel="canonical"\s+href="([^"]*)"/i)?.[1] || "",
    h1Count: (html.match(/<h1\b/gi) || []).length,
    productSchemaCount: (html.match(/"@type"\s*:\s*"Product"/g) || []).length,
    breadcrumbSchemaCount: (html.match(/"@type"\s*:\s*"BreadcrumbList"/g) || []).length,
    noindex: /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html),
  };
});

const imageChecks = await mapLimit(content.products, 10, async (product) => {
  const url = absolute(product.image);
  const response = await fetch(url, { redirect: "follow", headers: { Range: "bytes=0-0", "User-Agent": "Lullubelle-SEO-Audit/1.0" } });
  await response.body?.cancel();
  return { id: product.id, url, status: response.status, contentType: response.headers.get("content-type") || "", finalUrl: response.url };
});

const sitemapResponse = await fetch(`${origin}/sitemap.xml`, { headers: { "User-Agent": "Lullubelle-SEO-Audit/1.0" } });
const sitemap = await sitemapResponse.text();
const robotsResponse = await fetch(`${origin}/robots.txt`, { headers: { "User-Agent": "Lullubelle-SEO-Audit/1.0" } });
const robots = await robotsResponse.text();
const categoryChecks = await mapLimit(content.productCategories || [], 8, async (category) => {
  const url = `${origin}/shop?category=${encodeURIComponent(category)}`;
  const response = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Lullubelle-SEO-Audit/1.0" } });
  const html = await response.text();
  return { category, url, status: response.status, title: html.match(/<title>(.*?)<\/title>/is)?.[1]?.trim() || "", h1Count: (html.match(/<h1\b/gi) || []).length };
});

const sitemapLocations = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
const sitemapMissing = visible.filter((product) => !sitemapLocations.includes(`${origin}/products/${encodeURIComponent(product.slug || product.id)}`)).map((product) => product.id);
const duplicateSitemapEntries = visible.flatMap((product) => {
  const path = `${origin}/products/${encodeURIComponent(product.slug || product.id)}`;
  const count = sitemapLocations.filter((location) => location === path).length;
  return count > 1 ? [{ id: product.id, count }] : [];
});
const result = {
  generatedAt: new Date().toISOString(),
  productPages: pageChecks,
  images: imageChecks,
  categories: categoryChecks,
  sitemap: { status: sitemapResponse.status, missingProductIds: sitemapMissing, duplicateProductEntries: duplicateSitemapEntries },
  robots: { status: robotsResponse.status, blocksProducts: /^Disallow:\s*\/products/im.test(robots), body: robots },
  summary: {
    pagesChecked: pageChecks.length,
    non200Pages: pageChecks.filter((item) => item.status !== 200).length,
    brokenImages: imageChecks.filter((item) => ![200, 206].includes(item.status)).length,
    missingSitemapProducts: sitemapMissing.length,
    duplicateSitemapEntries: duplicateSitemapEntries.length,
    categoryPagesChecked: categoryChecks.length,
  },
};
await mkdir("reports/seo", { recursive: true });
await writeFile("reports/seo/production-page-audit.json", `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result.summary, null, 2));
