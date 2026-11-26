import { test, expect } from "@playwright/test";

test("discount brand selections survive saving and reloading", async ({ page }) => {
  const brandIds = ["kalahari", "vitaderm"];
  const content = {
    brands: brandIds.map((id) => ({ id, name: id, active: true })),
    products: [], treatments: [], gallery: [], vouchers: [], deliverySettings: {},
  };
  let discounts = [{ id: "discount-1", code: "LULLU25", name: "Black Friday", scope: "brands", brandIds: [] }];
  await page.route("**/.netlify/functions/admin-api**", async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    if (action === "discounts" && route.request().method() === "PUT") {
      discounts = route.request().postDataJSON().items;
      return route.fulfill({ json: { items: discounts } });
    }
    const json = action === "me" ? { authenticated: true }
      : action === "content" ? content
      : action === "discounts" ? discounts : [];
    await route.fulfill({ json });
  });

  await page.goto("http://127.0.0.1:4173/admin/");
  const tab = page.locator("[data-tab='discounts']");
  await tab.click();
  const brands = page.locator("[data-record='discounts'] [data-key='brandIds']");
  // Exercise browsers that only emit change for a multiple select.
  await brands.evaluate((select, ids) => {
    for (const option of select.options) option.selected = ids.includes(option.value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, brandIds);
  await page.getByRole("button", { name: "Save discounts" }).click();
  await expect(page.locator("[data-admin-status]")).toContainText("Discounts saved.");
  expect(discounts[0].brandIds).toEqual(brandIds);
  await expect(brands).toHaveValues(brandIds);

  await page.reload();
  await tab.click();
  await expect(brands).toHaveValues(brandIds);
});
