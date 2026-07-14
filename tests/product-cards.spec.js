import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import sharp from "sharp";

const base = "http://127.0.0.1:4173";
const products = JSON.parse(readFileSync("data/products.json", "utf8"));
const viewports = [
  [320, 720], [360, 800], [390, 844], [430, 932], [768, 1024],
  [1024, 900], [1280, 960], [1440, 1000], [1920, 1080],
];

const observeFailures = (page) => {
  const failures = [];
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (/\.(?:avif|gif|jpe?g|png|svg|webp)(?:\?|$)/i.test(request.url()) && request.failure()?.errorText !== "net::ERR_ABORTED") failures.push(`request: ${request.url()} ${request.failure()?.errorText || "failed"}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && /\.(?:avif|gif|jpe?g|png|svg|webp)(?:\?|$)/i.test(response.url())) {
      failures.push(`image: ${response.status()} ${response.url()}`);
    }
  });
  return failures;
};

const openCatalogue = async (page, brand = "kalahari") => {
  await page.goto(`${base}/shop.html?brand=${brand}`, { waitUntil: "networkidle" });
  await expect(page.locator(".product-card").first()).toBeVisible();
  await page.waitForFunction(() => [...document.images].filter((image) => image.closest(".product-card") && image.loading !== "lazy").every((image) => image.complete));
};

const screenshotSkuRange = async (page, skus, path) => {
  const boxes = await page.evaluate((requestedSkus) => requestedSkus.map((sku) => {
    const card = document.querySelector(`article[data-product-sku="${sku}"]`);
    if (!card) return null;
    const box = card.getBoundingClientRect();
    return { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height };
  }).filter(Boolean), skus);
  expect(boxes).toHaveLength(skus.length);
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  const source = "test-results/sku-range-source.png";
  await page.screenshot({ path: source, fullPage: true });
  await sharp(source).extract({
    left: Math.max(0, Math.floor(left)),
    top: Math.max(0, Math.floor(top)),
    width: Math.ceil(right - left),
    height: Math.ceil(bottom - top),
  }).png().toFile(path);
};

for (const [width, height] of viewports) {
  test(`shop cards at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const failures = observeFailures(page);
    await openCatalogue(page, width <= 430 ? "mesoestetic" : "vitaderm");
    const metrics = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      cards: [...document.querySelectorAll(".product-card")].map((card) => {
        const image = card.querySelector(".product-card__image");
        const button = card.querySelector(".product-card__actions .button");
        return {
          cardWidth: card.getBoundingClientRect().width,
          imageOverflow: image ? image.scrollWidth > image.clientWidth || image.scrollHeight > image.clientHeight : false,
          buttonHeight: button?.getBoundingClientRect().height || 44,
        };
      }),
    }));
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.viewport + 1);
    expect(metrics.cards.length).toBeGreaterThan(0);
    expect(metrics.cards.every((card) => !card.imageOverflow && card.buttonHeight >= 44)).toBeTruthy();
    const actionBottoms = await page.locator(".product-card__actions").evaluateAll((actions) => actions.map((action) => ({ top: action.closest(".product-card").getBoundingClientRect().top, bottom: action.getBoundingClientRect().bottom })));
    for (const row of Map.groupBy(actionBottoms, (item) => Math.round(item.top))) {
      const bottoms = row[1].map((item) => item.bottom);
      expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThanOrEqual(2);
    }
    expect(failures).toEqual([]);
  });
}

test("requested visual evidence", async ({ page }) => {
  test.setTimeout(90_000);
  const failures = observeFailures(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openCatalogue(page, "kalahari");
  await page.screenshot({ path: "reports/screenshots/shop-desktop-1440.png", fullPage: true });
  const cards = page.locator(".product-card");
  await cards.nth(0).screenshot({ path: "reports/screenshots/kalahari-top-card.png" });
  await cards.nth(Math.floor(await cards.count() / 2)).screenshot({ path: "reports/screenshots/kalahari-middle-card.png" });
  await cards.last().screenshot({ path: "reports/screenshots/kalahari-final-card.png" });
  await screenshotSkuRange(page, ["DD05", "DD03", "DD04"], "reports/screenshots/kalahari-dd-cream-shades.png");
  await screenshotSkuRange(page, ["PFF01", "PFF02", "PFF03"], "reports/screenshots/kalahari-foundation-shades.png");
  await screenshotSkuRange(page, ["FK1170", "FK1175", "FK1007", "FK1180", "FK1190", "FK1025"], "reports/screenshots/kalahari-lip-variants.png");
  await screenshotSkuRange(page, ["D008A", "D11", "D13", "D12"], "reports/screenshots/kalahari-kits.png");
  await screenshotSkuRange(page, ["FK1027", "FK1026"], "reports/screenshots/kalahari-refill-pouches.png");

  await openCatalogue(page, "soopa");
  await page.locator(".kalahari-grid").screenshot({ path: "reports/screenshots/soopa-section.png" });

  await openCatalogue(page, "kalahari");
  await page.locator('[data-product-sku="D008A"] [data-managed-cart-add]').click();
  await page.locator('[data-product-sku="PH010"] [data-managed-cart-add]').click();
  await page.goto(`${base}/cart.html`, { waitUntil: "networkidle" });
  await expect(page.locator(".cart-item")).toHaveCount(2);
  await page.screenshot({ path: "reports/screenshots/cart-mixed-product-shapes.png", fullPage: true });

  await page.setViewportSize({ width: 768, height: 1024 });
  await openCatalogue(page, "vitaderm");
  await page.screenshot({ path: "reports/screenshots/shop-tablet-768-vitaderm.png", fullPage: true });
  await page.locator(".kalahari-grid").screenshot({ path: "reports/screenshots/vitaderm-section.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await openCatalogue(page, "mesoestetic");
  await page.screenshot({ path: "reports/screenshots/shop-mobile-390-mesoestetic.png", fullPage: true });
  await page.locator(".kalahari-grid").screenshot({ path: "reports/screenshots/mesoestetic-section.png" });

  await page.goto(`${base}/product.html?id=vitaderm-nourish-revitalise-pack`, { waitUntil: "networkidle" });
  await expect(page.locator(".product-detail-main-image")).toBeVisible();
  await page.screenshot({ path: "reports/screenshots/product-detail.png", fullPage: true });

  await page.goto(base, { waitUntil: "networkidle" });
  await expect(page.locator(".home-product-card").first()).toBeVisible();
  await page.locator("[data-featured-products]").screenshot({ path: "reports/screenshots/homepage-best-sellers.png" });

  failures.length = 0;
  await page.route("**/.netlify/functions/admin-api?*", async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    const body = action === "content"
      ? { brands: [], products, treatments: [], gallery: [], vouchers: [], deliverySettings: {} }
      : action === "me" ? { authenticated: true } : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/admin/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await expect(page.locator(".product-list-thumb").first()).toBeVisible();
  await page.screenshot({ path: "reports/screenshots/admin-product-grid.png" });
  expect(failures).toEqual([]);
});
