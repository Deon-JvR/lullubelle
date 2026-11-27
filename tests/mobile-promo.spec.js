import { test, expect } from "@playwright/test";

test.use({ hasTouch: true, isMobile: true });

for (const width of [320, 390, 412]) {
  test(`promo code can be tapped, typed, and applied at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const item = { id: "mask", name: "Kalahari mask", quantity: 1, price: 553 };
    await page.addInitScript((item) => localStorage.setItem("lullubelleCart", JSON.stringify([item])), item);
    await page.route("**/.netlify/functions/admin-content**", (route) => route.fulfill({
      json: { brands: [], products: [item], treatments: [], vouchers: [], gallery: [], deliverySettings: {} },
    }));
    await page.route("**/.netlify/functions/ikhokha-checkout?action=validate-promo", (route) => {
      expect(route.request().postDataJSON().promoCode).toBe("LULLU25");
      return route.fulfill({ json: { promoCode: "LULLU25", productDiscount: 138.25, discountAmount: 138.25,
        deliveryFee: 0, total: 414.75, message: "LULLU25 applied." } });
    });
    await page.goto("http://127.0.0.1:4173/cart.html");
    const field = page.getByLabel("Promo code", { exact: true });
    const apply = page.getByRole("button", { name: "Apply", exact: true });
    const bounds = await field.boundingBox();
    expect(bounds.width).toBeGreaterThan(120);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    await field.tap();
    await expect(field).toBeFocused();
    await page.keyboard.type("LULLU25");
    await expect(field).toHaveValue("LULLU25");
    await apply.tap();
    await expect(page.locator("[data-promo-status]")).toHaveText("LULLU25 applied.");
    await expect(page.locator("[data-promo-remove]")).toBeVisible();
    expect((await field.boundingBox()).width).toBeGreaterThan(100);
  });
}
