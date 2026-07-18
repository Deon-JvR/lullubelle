import { test, expect } from "@playwright/test";

const base = "http://127.0.0.1:4173";
const viewports = [320, 360, 390, 412, 768, 1024, 1366, 1920];
const product = { id: "cleanser", name: "Hydrating Cleanser", price: 250, quantity: 1, image: "lullubelle-logo.jpg" };

const openPhysicalCart = async (page, width) => {
  await page.setViewportSize({ width, height: width <= 412 ? 844 : 1000 });
  await page.addInitScript((cart) => localStorage.setItem("lullubelleCart", JSON.stringify(cart)), [product]);
  await page.route("**/.netlify/functions/admin-content**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ brands: [], products: [], treatments: [], gallery: [], vouchers: [], deliverySettings: {} }),
  }));
  await page.goto(`${base}/cart.html`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".checkout-delivery-options label")).toHaveCount(3);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.complete ? undefined : new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
    })));
  });
};

for (const width of viewports) {
  test(`delivery options remain stacked at ${width}px`, async ({ page }) => {
    await openPhysicalCart(page, width);
    const selector = page.locator(".checkout-delivery-options");
    await expect(selector.locator("label")).toContainText([
      "Collect from Lullubelle (Centurion)",
      "PUDO Locker Delivery",
      "Door-to-Door Delivery",
    ]);
    await expect(selector.locator('input[type="radio"]')).toHaveCount(3);
    const before = await selector.evaluate((fieldset) => {
      const labels = [...fieldset.querySelectorAll("label")];
      return {
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        labels: labels.map((label) => {
          const box = label.getBoundingClientRect();
          const radio = label.querySelector("input").getBoundingClientRect();
          const price = label.querySelector("strong").getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, right: box.right, radioX: radio.x, radioY: radio.y, priceRight: price.right };
        }),
      };
    });
    const after = await selector.evaluate((fieldset) => [...fieldset.querySelectorAll("label")].map((label) => {
      const box = label.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width };
    }));

    expect(before.documentWidth).toBeLessThanOrEqual(before.viewportWidth + 1);
    expect(before.labels.map((label) => Math.round(label.width))).toEqual([Math.round(before.labels[0].width), Math.round(before.labels[0].width), Math.round(before.labels[0].width)]);
    expect(before.labels.map((label) => Math.round(label.x))).toEqual([Math.round(before.labels[0].x), Math.round(before.labels[0].x), Math.round(before.labels[0].x)]);
    expect(before.labels[0].y).toBeLessThan(before.labels[1].y);
    expect(before.labels[1].y).toBeLessThan(before.labels[2].y);
    expect(before.labels.every((label) => Math.abs(label.radioX - before.labels[0].radioX) <= 1)).toBeTruthy();
    expect(before.labels.every((label) => Math.abs(label.priceRight - label.right) <= 13)).toBeTruthy();
    expect(after).toEqual(before.labels.map(({ x, y, width: labelWidth }) => ({ x, y, width: labelWidth })));
  });
}

test("delivery option visual evidence", async ({ page }) => {
  await openPhysicalCart(page, 390);
  await page.locator(".conversion-dock").evaluate((dock) => { dock.style.display = "none"; });
  await page.locator(".cart-delivery-card").screenshot({ path: "reports/screenshots/delivery-options-mobile-390.png" });
  await openPhysicalCart(page, 1366);
  await page.locator(".conversion-dock").evaluate((dock) => { dock.style.display = "none"; });
  await page.locator(".cart-delivery-card").screenshot({ path: "reports/screenshots/delivery-options-desktop-1366.png" });
});
