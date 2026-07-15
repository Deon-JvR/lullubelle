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
const expectOrderCounts = async (page, { active, archived, all, abandoned }) => {
  const filter = page.locator("[data-order-filter]");
  await expect(filter.locator('option[value="active"]')).toHaveText(`Active orders (${active})`);
  await expect(filter.locator('option[value="archived"]')).toHaveText(`Archived orders (${archived})`);
  await expect(filter.locator('option[value="all"]')).toHaveText(`All orders (${all})`);
  await expect(filter.locator('option[value="abandoned"]')).toHaveText(`Likely abandoned (${abandoned})`);
};

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

test("Successful and repeated archive updates canonical counts without trusting a stale GET", async ({ page }) => {
  const activeOrder = { ...order, orderNumber: "LUL-1784149490045", paymentStatus: "Pending", orderStatus: "New" };
  let ordersGets = 0;
  let archiveCalls = 0;
  await page.route("**/.netlify/functions/admin-api**", async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    if (action === "archive-order") { archiveCalls += 1; const callNumber = archiveCalls; await new Promise((resolve) => setTimeout(resolve, 100)); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, changed: callNumber === 1 ? 1 : 0, orderNumber: "LUL-1784149490045", archived: true, archivedAt: "2026-07-15T23:05:24.907Z" }) }); }
    if (action === "orders") ordersGets += 1;
    const payload = action === "me" ? { authenticated: true } : action === "content" ? { brands: [], products: [], treatments: [], gallery: [], vouchers: [], deliverySettings: {} } : action === "orders" ? [activeOrder] : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(`${base}/admin/`, { waitUntil: "networkidle" });
  await page.locator('[data-tab="orders"]').click();
  await expectOrderCounts(page, { active: 1, archived: 0, all: 1, abandoned: 0 });
  await page.evaluate(() => { const button = document.querySelector("[data-order-archive]"); button.click(); button.click(); });
  await expect.poll(() => archiveCalls).toBe(2);
  await expect(page.locator('[data-panel="orders"]')).not.toContainText(activeOrder.orderNumber);
  await expectOrderCounts(page, { active: 0, archived: 1, all: 1, abandoned: 0 });
  await expect.poll(() => ordersGets).toBe(1);
  await page.locator("[data-order-filter]").selectOption("archived");
  await expect(page.locator('[data-panel="orders"]')).toContainText(activeOrder.orderNumber);
  await expect(page.locator("[data-order-archive]")).toHaveText("Restore order");
  await expectOrderCounts(page, { active: 0, archived: 1, all: 1, abandoned: 0 });
});

test("Successful restore returns an order to Active without trusting a stale GET", async ({ page }) => {
  const archivedOrder = { ...order, archived: true, archivedAt: "2026-07-15T10:00:00.000Z", paymentStatus: "Pending", orderStatus: "New" };
  let ordersGets = 0;
  await page.route("**/.netlify/functions/admin-api**", async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    if (action === "restore-order") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, changed: 1, orderNumber: archivedOrder.orderNumber, archived: false, archivedAt: null }) });
    if (action === "orders") ordersGets += 1;
    const payload = action === "me" ? { authenticated: true } : action === "content" ? { brands: [], products: [], treatments: [], gallery: [], vouchers: [], deliverySettings: {} } : action === "orders" ? [archivedOrder] : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(`${base}/admin/`, { waitUntil: "networkidle" });
  await page.locator('[data-tab="orders"]').click();
  await page.locator("[data-order-filter]").selectOption("archived");
  await expectOrderCounts(page, { active: 0, archived: 1, all: 1, abandoned: 0 });
  await page.locator("[data-order-archive]").click();
  await expect(page.locator('[data-panel="orders"]')).not.toContainText(archivedOrder.orderNumber);
  await expectOrderCounts(page, { active: 1, archived: 0, all: 1, abandoned: 0 });
  await expect.poll(() => ordersGets).toBe(1);
  await page.locator("[data-order-filter]").selectOption("active");
  await expect(page.locator('[data-panel="orders"]')).toContainText(archivedOrder.orderNumber);
  await expect(page.locator("[data-order-archive]")).toHaveText("Archive order");
});

test("Bulk archive updates only confirmed orders and clears selection", async ({ page }) => {
  const orders = [
    { ...order, id: "ord_bulk_1", orderNumber: "LB-BULK-1", paymentStatus: "Pending", orderStatus: "New" },
    { ...order, id: "ord_bulk_2", orderNumber: "LB-BULK-2", paymentStatus: "Pending", orderStatus: "New" },
    { ...order, id: "ord_bulk_3", orderNumber: "LB-BULK-3", paymentStatus: "Pending", orderStatus: "New" },
  ];
  await page.route("**/.netlify/functions/admin-api**", async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    if (action === "archive-orders") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, changed: 1, orderNumbers: [orders[0].orderNumber], archived: true, archiveStates: [{ orderNumber: orders[0].orderNumber, archived: true, archivedAt: "2026-07-16T10:00:00.000Z" }] }) });
    const payload = action === "me" ? { authenticated: true } : action === "content" ? { brands: [], products: [], treatments: [], gallery: [], vouchers: [], deliverySettings: {} } : action === "orders" ? orders : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(`${base}/admin/`, { waitUntil: "networkidle" });
  await page.locator('[data-tab="orders"]').click();
  await page.locator("[data-order-select]").nth(0).check();
  await page.locator("[data-order-select]").nth(1).check();
  await page.locator("[data-archive-selected]").click();
  await expect(page.locator('[data-panel="orders"]')).not.toContainText(orders[0].orderNumber);
  await expect(page.locator('[data-panel="orders"]')).toContainText(orders[1].orderNumber);
  await expect(page.locator('[data-panel="orders"]')).toContainText(orders[2].orderNumber);
  await expect(page.locator("[data-order-select]:checked")).toHaveCount(0);
  await expect(page.locator("[data-archive-selected]")).toHaveText("Archive selected (0)");
  await expectOrderCounts(page, { active: 2, archived: 1, all: 3, abandoned: 0 });
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
