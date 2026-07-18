import { test, expect } from "@playwright/test";

const base = "http://127.0.0.1:4173";
const brands = ["Kalahari", "Mesoestetic", "Cirépil", "Dr. Pen", "VitaDerm", "Epilfree"];
const viewports = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1366, height: 900 },
];

const openBrandGrid = async (page, viewport) => {
  const assetFailures = [];
  page.on("response", (response) => {
    if (response.url().includes("/assets/brands/") && response.status() >= 400) {
      assetFailures.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("/assets/brands/")) {
      assetFailures.push(`${request.failure()?.errorText || "failed"} ${request.url()}`);
    }
  });

  await page.setViewportSize(viewport);
  await page.goto(base, { waitUntil: "domcontentloaded" });
  const grid = page.locator(".partner-brand-grid");
  await expect(grid).toBeVisible();
  await expect(grid.locator(".brand-tile")).toHaveCount(6);
  for (const logo of await grid.locator("img").all()) await logo.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelectorAll(".partner-brand-grid img")]
    .every((image) => image.complete && image.naturalWidth > 0));
  expect(assetFailures).toEqual([]);
  return grid;
};

for (const viewport of viewports) {
  test(`brand logos remain aligned at ${viewport.width}px`, async ({ page }) => {
    const grid = await openBrandGrid(page, viewport);
    const metrics = await grid.evaluate((element) => ({
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      cards: [...element.querySelectorAll(".brand-tile")].map((card) => {
        const cardBox = card.getBoundingClientRect();
        const wrapBox = card.querySelector(".brand-logo-wrap").getBoundingClientRect();
        const logo = card.querySelector("img");
        const logoBox = logo.getBoundingClientRect();
        const subtitleBox = card.querySelector("small").getBoundingClientRect();
        return {
          top: Math.round(cardBox.top),
          height: cardBox.height,
          subtitleBottom: subtitleBox.bottom,
          objectFit: getComputedStyle(logo).objectFit,
          centredX: Math.abs((logoBox.left + logoBox.right) / 2 - (wrapBox.left + wrapBox.right) / 2),
          centredY: Math.abs((logoBox.top + logoBox.bottom) / 2 - (wrapBox.top + wrapBox.bottom) / 2),
          clipped: logoBox.left < wrapBox.left - 1 || logoBox.right > wrapBox.right + 1 || logoBox.top < wrapBox.top - 1 || logoBox.bottom > wrapBox.bottom + 1,
        };
      }),
    }));

    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.cards.every((card) => card.objectFit === "contain" && !card.clipped)).toBeTruthy();
    expect(metrics.cards.every((card) => card.centredX <= 1 && card.centredY <= 1)).toBeTruthy();

    for (const row of Map.groupBy(metrics.cards, (card) => card.top).values()) {
      expect(Math.max(...row.map((card) => card.height)) - Math.min(...row.map((card) => card.height))).toBeLessThanOrEqual(1);
      expect(Math.max(...row.map((card) => card.subtitleBottom)) - Math.min(...row.map((card) => card.subtitleBottom))).toBeLessThanOrEqual(1);
    }
  });
}

test("brand logos expose accessible names and stable intrinsic dimensions", async ({ page }) => {
  const grid = await openBrandGrid(page, { width: 1366, height: 900 });
  const logos = grid.locator("img.brand-logo");
  await expect(logos).toHaveCount(brands.length);
  const altText = await logos.evaluateAll((images) => images.map((image) => image.alt));
  expect(altText.every((alt) => /\S/.test(alt))).toBeTruthy();
  expect(altText).toEqual(brands);

  const rasterDimensions = await logos.evaluateAll((images) => images
    .filter((image) => !image.src.endsWith(".svg"))
    .map((image) => ({ width: image.getAttribute("width"), height: image.getAttribute("height") })));
  expect(rasterDimensions.every(({ width, height }) => Number(width) > 0 && Number(height) > 0)).toBeTruthy();
});

test("brand logo visual evidence", async ({ page }) => {
  let grid = await openBrandGrid(page, { width: 390, height: 844 });
  await grid.screenshot({ path: "reports/screenshots/brand-logos-mobile-390.png" });

  grid = await openBrandGrid(page, { width: 1366, height: 900 });
  await grid.screenshot({ path: "reports/screenshots/brand-logos-desktop-1366.png" });
});
