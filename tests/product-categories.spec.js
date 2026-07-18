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
    expect(await select.locator("option").evaluateAll((options) => new Set(options.map((option) => option.value)).size)).toBe(17);

    const category = "Prepare";
    await select.selectOption(category);
    await expect(select).toHaveValue(category);
    const expectedCount = activeProducts.filter((product) => product.category === category).length;
    await expect(page.locator("[data-shop-product-grid] .product-card")).toHaveCount(expectedCount);
    await expect(page.locator("[data-shop-product-grid] .product-category-link")).toHaveText(Array(expectedCount).fill(category));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
