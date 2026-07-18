import { test, expect } from "@playwright/test";

const base = "http://127.0.0.1:4173";

for (const pageName of ["cosmelan-centurion.html", "facials-centurion.html"]) {
  test(`${pageName} reaches a deterministic gallery state`, async ({ page }) => {
    await page.goto(`${base}/${pageName}`, { waitUntil: "domcontentloaded" });
    const gallery = page.locator("[data-managed-gallery-preview]");
    await expect(gallery).toHaveAttribute("data-gallery-state", /^(ready|empty)$/);
    const state = await gallery.getAttribute("data-gallery-state");
    if (state === "ready") {
      await expect(gallery).toBeVisible();
      await expect(gallery.locator("[data-managed-gallery-media] img")).toHaveCount(1);
      await expect(gallery.locator("[data-managed-gallery-title]")).not.toHaveText("");
    } else {
      await expect(gallery).toBeHidden();
    }
  });
}
