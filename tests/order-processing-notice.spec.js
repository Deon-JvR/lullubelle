import { test, expect } from "@playwright/test";

const base = "http://127.0.0.1:4173";
const notice = "Orders are processed within 5–10 business days before collection or dispatch.";
const product = { id: "cleanser", name: "Hydrating Cleanser", price: 250, quantity: 1, image: "lullubelle-logo.jpg" };
const voucher = { id: "gift-voucher-500", name: "Lullubelle Gift Voucher R500", price: 500, quantity: 1, image: "lullubelle-logo.jpg" };

const openCartWith = async (page, items) => {
  await page.addInitScript(({ cart }) => localStorage.setItem("lullubelleCart", JSON.stringify(cart)), { cart: items });
  await page.route("**/.netlify/functions/admin-content**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ brands: [], products: [], treatments: [], gallery: [], vouchers: [], deliverySettings: {} }),
  }));
  await page.goto(`${base}/cart.html`, { waitUntil: "networkidle" });
};

test("physical cart and checkout show processing and fulfilment timing", async ({ page }) => {
  await openCartWith(page, [product]);
  await expect(page.locator("[data-order-processing-notice]")).toContainText(notice);
  await expect(page.locator("[data-checkout-processing-notice]")).toContainText(notice);
  await expect(page.locator("[data-order-processing-detail]")).toHaveText("Collection is available only after we notify you that your order is ready.");
  await page.locator("input[value='pudo']").check();
  await expect(page.locator("[data-checkout-processing-detail]")).toHaveText("Delivery transit time begins only after your order has been dispatched.");
});

test("voucher-only cart excludes the physical processing notice", async ({ page }) => {
  await openCartWith(page, [voucher]);
  await expect(page.locator("[data-order-processing-notice]")).toBeHidden();
  await expect(page.locator("[data-checkout-processing-notice]")).toBeHidden();
});

test("order confirmation conditionally shows the processing notice", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("lullubelleCheckoutFulfilment", JSON.stringify({ physical: true, deliveryOption: "pudo" })));
  await page.goto(`${base}/payment-success.html`);
  const confirmation = page.locator("[data-confirmation-processing-notice]");
  await expect(confirmation).toContainText(notice);
  await expect(confirmation).toContainText("Delivery transit time begins only after your order has been dispatched.");
});

test("voucher-only order confirmation excludes the processing notice", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("lullubelleCheckoutFulfilment", JSON.stringify({ physical: false, deliveryOption: "collection" })));
  await page.goto(`${base}/payment-success.html`);
  await expect(page.locator("[data-confirmation-processing-notice]")).toBeHidden();
});
