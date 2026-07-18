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
  categories: ["Prepare"],
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
  return { get saves() { return saves; }, get stored() { return stored; } };
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
  const categoryControls = page.locator(".product-editor [data-product-category]");
  await expect(categoryControls).toHaveCount(productCategories.length);
  await expect(page.locator(".product-editor [data-product-category][value='Prepare']")).toBeChecked();
  await expect(page.locator(".product-editor [data-product-category][value='Hydration']")).not.toBeChecked();
});

test("New products require a category and products can retain multiple categories", async ({ page }) => {
  const multi = { ...product(1), categories: ["Prepare", "Hydration"] };
  const calls = await routeAdmin(page, [multi, ...Array.from({ length: 64 }, (_, index) => product(index + 2))]);
  await page.goto(`${base}/admin/`, { waitUntil: "networkidle" });
  await page.locator("[data-product-name='product-1']").click();
  await expect(page.locator("[data-product-category][value='Prepare']")).toBeChecked();
  await expect(page.locator("[data-product-category][value='Hydration']")).toBeChecked();
  await expect(page.locator("#product-category-help")).toContainText("Prepare, Hydration");
  await page.locator(".product-editor [data-save]").click();
  await expect(page.locator("[data-admin-status]")).toContainText("Website content saved and verified.");
  expect(calls.stored.products.find((item) => item.id === multi.id).categories).toEqual(["Prepare", "Hydration"]);
  await page.locator("[data-product-back]").first().click();
  await page.locator("[data-add='products']").click();
  await expect(page.locator(".product-editor [data-product-category]:checked")).toHaveCount(0);
  await page.locator(".product-editor [data-save]").click();
  await expect(page.locator("[data-admin-status]")).toContainText("Select at least one approved category");
  await page.locator(`.product-editor [data-product-category][value='${productCategories[0]}']`).check();
  await page.locator(".product-editor [data-product-category][value='Hydration']").check();
  await expect(page.locator(".product-editor [data-product-category]:checked")).toHaveCount(2);
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

test("Admin refreshes its session and preserves an edit when re-authentication is required", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let refreshes = 0;
  let expireNextSave = true;
  let stored = content(Array.from({ length: 65 }, (_, index) => product(index + 1)));
  await page.route("**/.netlify/functions/admin-api**", async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    const method = route.request().method();
    if (action === "refresh-session") {
      refreshes += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, authenticated: true }) });
    }
    if (action === "login") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    if (action === "content" && method === "PUT") {
      if (expireNextSave) {
        expireNextSave = false;
        return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ ok: false, code: "ADMIN_AUTH_REQUIRED", message: "Your admin session has expired. Please sign in again." }) });
      }
      stored = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stored) });
    }
    const payload = action === "me" ? { authenticated: true } : action === "content" ? stored : [];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });

  await page.clock.install();
  await page.goto(`${base}/admin/`, { waitUntil: "networkidle" });
  await page.clock.fastForward(4 * 60 * 1000);
  await expect.poll(() => refreshes).toBeGreaterThan(0);

  const price = page.locator("[data-product-key='price']").first();
  await price.fill("456");
  await price.press("Tab");
  await page.locator("[data-save]").click();
  await expect(page.locator("[data-login-panel]")).toBeVisible();
  await expect(page.locator("[data-login-status]")).toHaveText("Your admin session has expired. Please sign in again.");

  await page.locator("[name='username']").fill("admin");
  await page.locator("[name='password']").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("[data-admin-portal]")).toBeVisible();
  await expect(page.locator("[data-product-key='price']").first()).toHaveValue("456");
  await expect(page.locator("[data-save-state]")).toHaveText("Unsaved changes");

  await page.locator("[data-save]").click();
  await expect(page.locator("[data-admin-status]")).toContainText("Website content saved and verified.");
});
