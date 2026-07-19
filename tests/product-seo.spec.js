import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const base = "http://127.0.0.1:4173";
const products = JSON.parse(readFileSync("data/products.json", "utf8"));
const product = products.find((item) => item.id === "vitaderm-eye-lip-repair");

for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 900 }]) {
  test(`direct product navigation exposes current SEO at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${base}/product.html?product=${encodeURIComponent(product.id)}`, { waitUntil: "networkidle" });
    await expect(page.locator("h1")).toHaveText(product.name);
    await expect(page).toHaveTitle(product.seoTitle);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", product.seoDescription);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://www.lullubelle.co.za/products/${product.slug || product.id}`);
    await expect(page.locator(".product-detail-main-image")).toHaveAttribute("alt", product.imageAlt);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(2);
    const schemas = await page.locator('script[type="application/ld+json"]').evaluateAll((nodes) => nodes.map((node) => JSON.parse(node.textContent)));
    const productSchema = schemas.find((schema) => schema["@type"] === "Product");
    expect(productSchema.offers.priceCurrency).toBe("ZAR");
    expect(productSchema.offers.price).toEqual(product.price);
    expect(productSchema.url).toBe(`https://www.lullubelle.co.za/products/${product.slug || product.id}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
}

test("product-to-product navigation replaces all metadata and schema without stale values", async ({ page }) => {
  const first = products.find((item) => item.brand === "Kalahari" && item.active !== false && item.hidden !== true);
  await page.goto(`${base}/product.html?product=${encodeURIComponent(first.id)}`, { waitUntil: "networkidle" });
  await expect(page.locator("h1")).toHaveText(first.name);
  const nextLink = page.locator("[data-product-navigation]").first();
  const href = await nextLink.getAttribute("href");
  const nextId = decodeURIComponent(href.split("/").pop());
  const next = products.find((item) => (item.slug || item.id) === nextId);
  await nextLink.click();
  await expect(page.locator("h1")).toHaveText(next.name);
  await expect(page).toHaveTitle(next.seoTitle);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", next.seoTitle);
  await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute("content", next.seoTitle);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://www.lullubelle.co.za/products/${next.slug || next.id}`);
  const schemas = await page.locator('script[type="application/ld+json"]').evaluateAll((nodes) => nodes.map((node) => JSON.parse(node.textContent)));
  expect(schemas.filter((schema) => schema["@type"] === "Product")).toHaveLength(1);
  expect(schemas.find((schema) => schema["@type"] === "Product").name).toBe(next.name);
  expect(schemas.find((schema) => schema["@type"] === "BreadcrumbList").itemListElement.at(-1).name).toBe(next.name);
  expect(await page.locator("body").textContent()).not.toContain(first.seoDescription);
});

test("category navigation updates title, description, canonical and H1 together", async ({ page }) => {
  await page.goto(`${base}/shop.html?category=Hydration`, { waitUntil: "networkidle" });
  await expect(page.locator(".shop-hero h1")).toHaveText("Hydration skincare products");
  await expect(page).toHaveTitle("Hydration Skincare Products | Lullubelle");
  await page.locator("[data-shop-category]").selectOption("Anti-Aging");
  await expect(page.locator(".shop-hero h1")).toHaveText("Anti-Aging skincare products");
  await expect(page).toHaveTitle("Anti-Aging Skincare Products | Lullubelle");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Anti-Aging Skincare Products | Lullubelle");
  await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute("content", "Anti-Aging Skincare Products | Lullubelle");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /category=Anti-Aging$/);
});
