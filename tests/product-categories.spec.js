import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const base = "http://127.0.0.1:4173";
const categories = JSON.parse(readFileSync("data/product-categories.json", "utf8"));
const products = JSON.parse(readFileSync("data/products.json", "utf8"));
const activeProducts = products.filter((product) => product.hidden !== true && product.active !== false && product.published !== false);

for (const width of [390, 1366]) {
  test(`shop category filter uses the shared ordered list at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto(`${base}/shop.html`, { waitUntil: "networkidle" });
    const select = page.locator("[data-shop-category]");
    await expect(select.locator("option")).toHaveText(["All categories", ...categories]);
    expect(await select.locator("option").evaluateAll((options) => new Set(options.map((option) => option.value)).size)).toBe(categories.length + 1);

    const category = "Prepare";
    await page.locator('[data-brand-filter="all"]').click();
    await select.selectOption(category);
    await expect(select).toHaveValue(category);
    const expectedCount = activeProducts.filter((product) => product.categories.includes(category)).length;
    await expect(page.locator("[data-shop-product-grid] .product-card")).toHaveCount(expectedCount);
    await expect(page.locator("[data-shop-product-grid] [data-product-categories]")).toHaveCount(expectedCount);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test("a multi-category product appears in each category and once in all-products and search", async ({ page }) => {
  const multi = activeProducts.find((product) => product.categories.length > 1);
  expect(multi).toBeTruthy();
  await page.goto(`${base}/shop.html?category=${encodeURIComponent(multi.categories[0])}`, { waitUntil: "networkidle" });
  await expect(page).toHaveTitle(new RegExp(multi.categories[0]));
  await expect(page.locator("[data-shop-catalogue-heading] h2")).toContainText(multi.categories[0]);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`category=${encodeURIComponent(multi.categories[0])}`));
  await expect(page.locator(`[data-shop-product-grid] .product-card[data-product-id='${multi.id}']`)).toHaveCount(1);
  await page.locator("[data-shop-category]").selectOption(multi.categories[1]);
  await expect(page.locator(`[data-shop-product-grid] .product-card[data-product-id='${multi.id}']`)).toHaveCount(1);

  await page.locator("[data-shop-category]").selectOption("all");
  const allIds = await page.locator("[data-shop-product-grid] .product-card[data-product-id]").evaluateAll((cards) => cards.map((card) => card.dataset.productId));
  expect(new Set(allIds).size).toBe(allIds.length);
  await page.locator("[data-shop-product-search]").fill(multi.name);
  await expect(page.locator(`[data-shop-product-grid] .product-card[data-product-id='${multi.id}']`)).toHaveCount(1);
});
