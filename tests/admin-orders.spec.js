import { test, expect } from "@playwright/test";

// Exercises the Orders panel with a representative API response.  The route
// stub keeps this test deterministic and, importantly, catches regressions
// where nested order data is dumped into textareas as JSON.
const base = "http://127.0.0.1:4173";
const order = {
  id: "ord_test_1",
  orderNumber: "LB-1001",
  createdAt: "2026-07-20T10:00:00.000Z",
  customer: { name: "Ada Lovelace", email: "ada@example.com", phone: "0123456789", notes: "Call on arrival" },
  delivery: { option: "delivery", label: "PUDO delivery", address: "1 Analytical Engine Way, Centurion" },
  products: [
    { name: "Hydrating Cleanser", brand: "Kalahari", sku: "D008A", quantity: 2, unitPrice: 250, lineTotal: 500, image: "public/images/products/kalahari/d008a.webp" },
    { name: "Rescue Mist", brand: "Soopa", sku: "SRM01", quantity: 1, unitPrice: 180, lineTotal: 180, image: "products/soopa/hocl-rescue-mist-daily.webp" },
  ],
  promoCode: "WELCOME10", subtotal: 680, originalSubtotal: 680, discountAmount: 68,
  deliveryFee: 80, total: 692, paymentStatus: "Paid", orderStatus: "Processing",
};
const fiveProductOrder = { ...order, id: "ord_test_5", orderNumber: "LB-1005", delivery: { option: "collection", label: "Collection from Lullubelle – Centurion", fee: 0 }, promoCode: "", discountAmount: 0, deliveryFee: 0, total: 1200, products: Array.from({ length: 5 }, (_, index) => ({ name: `Product ${index + 1}`, brand: "Kalahari", sku: `SKU${index + 1}`, quantity: 1, unitPrice: 240, lineTotal: 240, image: "public/images/products/kalahari/d008a.webp" })) };

test("Orders renders structured details without raw JSON", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/.netlify/functions/admin-api**", async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    const payload = action === "me" ? { authenticated: true }
      : action === "content" ? { brands: [], products: [], treatments: [], gallery: [], vouchers: [], deliverySettings: {} }
        : action === "orders" ? [order] : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await page.goto(`${base}/admin/`, { waitUntil: "networkidle" });
  await page.locator('[data-tab="orders"]').click();
  const panel = page.locator('[data-panel="orders"]');
  await expect(panel).toContainText("Ada Lovelace");
  await expect(panel).toContainText("Hydrating Cleanser");
  await expect(panel).toContainText("WELCOME10");
  await expect(panel.locator("textarea")).toHaveCount(0);
  await expect(panel).not.toContainText('"customer"');
  await expect(panel).not.toContainText('"products"');
  await expect(panel).not.toContainText("/.netlify/functions/");
  await expect(panel.locator("img").first()).toHaveAttribute("src", /d008a/);
  await expect(panel.locator("[data-key='paymentStatus']").last()).toHaveValue("Paid");
  await expect(panel.locator("[data-key='orderStatus']")).toHaveValue("Processing");
  expect(errors).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBeFalsy();
  await page.screenshot({ path: "reports/screenshots/admin-order-one-product-desktop.png", fullPage: true });
});

test("Orders remains single-column on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/.netlify/functions/admin-api**", async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    const payload = action === "me" ? { authenticated: true } : action === "content" ? { brands: [], products: [], treatments: [], gallery: [], vouchers: [], deliverySettings: {} } : action === "orders" ? [order] : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await page.goto(`${base}/admin/`, { waitUntil: "networkidle" });
  await page.locator('[data-tab="orders"]').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  await page.screenshot({ path: "reports/screenshots/admin-order-mobile.png", fullPage: true });
});

test("Orders captures a five-product collection view", async ({ page }) => {
  await page.route("**/.netlify/functions/admin-api**", async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    const payload = action === "me" ? { authenticated: true } : action === "content" ? { brands: [], products: [], treatments: [], gallery: [], vouchers: [], deliverySettings: {} } : action === "orders" ? [fiveProductOrder] : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(`${base}/admin/`, { waitUntil: "networkidle" });
  await page.locator('[data-tab="orders"]').click();
  await expect(page.locator('[data-panel="orders"] .order-product')).toHaveCount(5);
  await expect(page.locator('[data-panel="orders"]')).toContainText("Collection from Lullubelle");
  await page.screenshot({ path: "reports/screenshots/admin-order-five-products-tablet.png", fullPage: true });
});

test("Verify payment delegates once and shows loading state", async ({ page }) => {
  let calls = 0;
  await page.route("**/.netlify/functions/admin-api**", async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    if (action === "reconcile-payment") { calls += 1; await new Promise((resolve) => setTimeout(resolve, 150)); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, reconciled: true }) }); }
    const payload = action === "me" ? { authenticated: true } : action === "content" ? { brands: [], products: [], treatments: [], gallery: [], vouchers: [], deliverySettings: {} } : action === "orders" ? [order] : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await page.goto(`${base}/admin/`, { waitUntil: "networkidle" });
  await page.locator('[data-tab="orders"]').click();
  const button = page.locator('[data-reconcile-payment]');
  await button.click();
  await page.evaluate(() => document.querySelector("[data-reconcile-payment]").click());
  await expect(button).toHaveText("Verifying payment…");
  await expect.poll(() => calls).toBe(1);
  await expect(button).toHaveText("Verify payment with iKhokha");
});

test("Archive persistence failures show the server message and keep the order visible", async ({ page }) => {
  const activeOrder = { ...order, paymentStatus: "Pending", orderStatus: "New" };
  await page.route("**/.netlify/functions/admin-api**", async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    if (action === "archive-order") {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, code: "ARCHIVE_PERSISTENCE_UNVERIFIED", message: "The archive change could not be verified in storage. Please try again." }),
      });
    }
    const payload = action === "me" ? { authenticated: true }
      : action === "content" ? { brands: [], products: [], treatments: [], gallery: [], vouchers: [], deliverySettings: {} }
        : action === "orders" ? [activeOrder] : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(`${base}/admin/`, { waitUntil: "networkidle" });
  await page.locator('[data-tab="orders"]').click();
  await page.locator("[data-order-archive]").click();
  await expect(page.locator("[data-admin-status]")).toContainText("The archive change could not be verified in storage. Please try again.");
  await expect(page.locator('[data-panel="orders"]')).toContainText(activeOrder.orderNumber);
  await expect(page.locator("[data-order-archive]")).toHaveText("Archive order");
});
