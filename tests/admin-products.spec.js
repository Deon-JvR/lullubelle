import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const productCategories = JSON.parse(readFileSync(new URL("../data/product-categories.json", import.meta.url), "utf8"));

const base = "http://127.0.0.1:4173";
const brand = { id: "brand-one", name: "Brand One", active: true, order: 1 };
const product = (index) => ({
  id: `product-${index}`,
  slug: `product-${index}`,
  sku: `SKU-${index}`,
  brandId: brand.id,
  brand: brand.name,
  category: "Prepare",
  name: `Product ${index}`,
  price: 100 + index,
  stockStatus: "In stock",
  image: `/public/images/products/kalahari/d008a.webp`,
  imageAlt: `Product ${index}`,
  hidden: false,
});
const content = (products) => ({ brands: [brand], products, productCategories, treatments: [], gallery: [], vouchers: [], deliverySettings: {} });

const routeAdmin = async (page, initialProducts, { failSave = false } = {}) => {
  let stored = content(initialProducts);
  let saves = 0;
  await page.route("**/.netlify/functions/admin-api**", async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    if (action === "content" && route.request().method() === "PUT") {
      saves += 1;
      if (failSave) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Product save failed." }) });
      stored = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stored) });
    }
    const payload = action === "me" ? { authenticated: true } : action === "content" ? stored : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  return { get saves() { return saves; } };
};

test("Products list keeps controls visible and exposes filters, tooltips and contextual bulk actions", async ({ page }) => {
  const calls = await routeAdmin(page, [product(1), product(2), product(3)]);
  await page.goto(`${base}/admin/`, { waitUntil: "networkidle" });
  await expect(page.locator(".product-table th").first()).toHaveCSS("position", "sticky");
  await expect(page.locator(".product-list-sticky")).toHaveCSS("position", "sticky");
  await expect(page.locator(".product-save-hint")).toContainText("pending until you use Save changes");
  await expect(page.locator(".product-list-thumb").first()).toHaveCSS("width", "64px");
  await expect(page.locator("[data-product-slug='product-1']")).toHaveAttribute("title", "product-1");
  await expect(page.locator("[data-product-row='product-1'] small").last()).toHaveAttribute("title", "SKU SKU-1");

  await page.locator("[data-product-filters-toggle]").click();
  await page.locator("[data-product-filter='visibility']").selectOption("visible");
  const chip = page.locator("[data-product-filter-clear='visibility']");
  await expect(chip).toContainText("Visibility: visible");
  await chip.click();
  await expect(page.locator("[data-product-filter='visibility']")).toHaveValue("all");

  await page.locator("[data-product-select='product-1']").check();
  const toolbar = page.locator(".bulk-action-buttons");
  await expect(toolbar).toBeVisible();
  for (const label of ["Show", "Hide", "In Stock", "Out of Stock", "Delete"]) await expect(toolbar.getByRole("button", { name: label, exact: true })).toBeVisible();

  await page.locator("[data-product-key='price']").first().fill("222");
  await page.locator("[data-product-key='price']").first().press("Tab");
  await expect(page.locator("[data-save-state]")).toHaveText("Unsaved changes");
  expect(calls.saves).toBe(0);

  await page.locator("[data-product-name='product-1']").click();
  await expect(page.locator(".product-editor")).toBeVisible();
  const category = page.locator(".product-editor select[data-key='category']");
  await expect(category).toHaveValue("Prepare");
  await expect(category.locator("option")).toHaveText(["Select a category", ...productCategories]);
  await expect(category.locator("option", { hasText: "All categories" })).toHaveCount(0);
});

test("New products require an approved category and legacy categories are preserved until corrected", async ({ page }) => {
  const legacy = { ...product(1), category: "Cleaning Tools & Disposables" };
  await routeAdmin(page, [legacy, ...Array.from({ length: 64 }, (_, index) => product(index + 2))]);
  await page.goto(`${base}/admin/`, { waitUntil: "networkidle" });
  await page.locator("[data-product-name='product-1']").click();
  const legacySelect = page.locator(".product-editor select[data-key='category']");
  await expect(legacySelect).toHaveValue("Cleaning Tools & Disposables");
  await expect(page.locator("#product-category-help")).toContainText("legacy category");
  await page.locator("[data-product-back]").first().click();
  await page.locator("[data-add='products']").click();
  const newCategory = page.locator(".product-editor select[data-key='category']");
  await expect(newCategory).toHaveValue("");
  await expect(newCategory.locator("option").first()).toHaveAttribute("disabled", "");
  await page.locator(".product-editor [data-save]").click();
  await expect(page.locator("[data-admin-status]")).toContainText("Select an approved category");
  await newCategory.selectOption(productCategories[0]);
  await expect(newCategory).toHaveValue(productCategories[0]);
});

test("Manual product save highlights changed rows and failed saves retain the edit", async ({ page }) => {
  const products = Array.from({ length: 65 }, (_, index) => product(index + 1));
  await routeAdmin(page, products);
  await page.goto(`${base}/admin/`, { waitUntil: "networkidle" });
  const price = page.locator("[data-product-key='price']").first();
  await price.fill("333");
  await price.press("Tab");
  await page.locator("[data-save]").click();
  await expect(page.locator("[data-admin-status]")).toContainText("Website content saved and verified.");
  await expect(page.locator("[data-product-row='product-1']")).toHaveClass(/is-saved/);

  await page.unroute("**/.netlify/functions/admin-api**");
  await routeAdmin(page, products, { failSave: true });
  await page.reload({ waitUntil: "networkidle" });
  const failedPrice = page.locator("[data-product-key='price']").first();
  await failedPrice.fill("444");
  await failedPrice.press("Tab");
  await page.locator("[data-save]").click();
  await expect(page.locator("[data-admin-status]")).toContainText("Product save failed.");
  await expect(failedPrice).toHaveValue("444");
  await expect(page.locator("[data-save-state]")).toHaveText("Unsaved changes");
});
