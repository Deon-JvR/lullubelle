import { test, expect } from "@playwright/test";

test("discount brand selections survive saving and reloading", async ({ page }) => {
  const brandIds = ["kalahari", "vitaderm"];
  const content = {
    brands: brandIds.map((id) => ({ id, name: id, active: true })),
    products: [], treatments: [], gallery: [], vouchers: [], deliverySettings: {},
  };
  let dropBrandSelections = false;
  let discounts = [{ id: "discount-1", code: "LULLU25", name: "Black Friday", scope: "brands", brandIds: [] }];
  await page.route("**/.netlify/functions/admin-api**", async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    if (action === "discounts" && route.request().method() === "PUT") {
      const { items } = route.request().postDataJSON();
      discounts = dropBrandSelections ? items.map((item) => ({ ...item, brandIds: [] })) : items;
      return route.fulfill({ json: { items } });
    }
    const json = action === "me" ? { authenticated: true }
      : action === "content" ? content
      : action === "discounts" ? discounts : [];
    await route.fulfill({ json });
  });

  await page.goto("http://127.0.0.1:4173/admin/");
  const tab = page.locator("[data-tab='discounts']");
  await tab.click();
  const brand = (id) => page.getByRole("checkbox", { name: id, exact: true });
  await brand("kalahari").check();
  await brand("vitaderm").check();
  await page.getByRole("button", { name: "Save discounts" }).click();
  await expect(page.locator("[data-admin-status]")).toContainText("Discounts saved and verified.");
  expect(discounts[0].brandIds).toEqual(brandIds);

  await page.reload();
  await tab.click();
  await expect(brand("kalahari")).toBeChecked();
  await expect(brand("vitaderm")).toBeChecked();

  await brand("vitaderm").uncheck();
  await page.getByRole("button", { name: "Save discounts" }).click();
  await expect(page.locator("[data-admin-status]")).toContainText("Discounts saved and verified.");
  await page.reload();
  await tab.click();
  await expect(brand("kalahari")).toBeChecked();
  await expect(brand("vitaderm")).not.toBeChecked();

  dropBrandSelections = true;
  await brand("vitaderm").check();
  await page.getByRole("button", { name: "Save discounts" }).click();
  await expect(page.locator("[data-admin-status]")).toContainText("Could not verify the saved brands for LULLU25");
  await expect(brand("kalahari")).toBeChecked();
  await expect(brand("vitaderm")).toBeChecked();
});
