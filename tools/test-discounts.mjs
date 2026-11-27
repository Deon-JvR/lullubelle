import assert from "node:assert/strict";
import { calculateDiscount, normalisePromoCode, sanitiseDiscount, validateDiscountRecord } from "../netlify/functions/_discounts.mjs";
import { discountFormTime, discountTimestamp } from "../public/discount-schedule.js";
import { buildIkhokhaPayload } from "../netlify/functions/ikhokha-checkout.mjs";

const products = [
  { id: "serum", brandId: "kalahari", categories: ["Serums", "Hydration"], price: 500, quantity: 2 },
  { id: "cleanser", brandId: "vitaderm", categories: ["Cleansers"], price: 200, quantity: 1 },
];
const discount = (input) => sanitiseDiscount({ code: "SAVE", name: "Test", active: true, type: "percentage", value: 10, scope: "order", brandIds: [], productIds: [], categories: [], excludedBrandIds: [], excludedProductIds: [], ...input });

assert.equal(normalisePromoCode("  save10  "), "SAVE10");
assert.equal(calculateDiscount({ discount: discount({ value: 10 }), products, subtotal: 1200, deliveryFee: 80 }).total, 1160);
assert.equal(calculateDiscount({ discount: discount({ type: "fixed", value: 250 }), products, subtotal: 1200, deliveryFee: 80 }).discountAmount, 250);
assert.deepEqual(calculateDiscount({ discount: discount({ value: 0, freeDelivery: true }), products, subtotal: 1200, deliveryFee: 80 }), { eligibleSubtotal: 1200, productDiscount: 0, deliveryDiscount: 80, discountAmount: 80, deliveryFee: 0, total: 1200 });
assert.equal(calculateDiscount({ discount: discount({ scope: "brands", brandIds: ["kalahari"] }), products, subtotal: 1200, deliveryFee: 0 }).discountAmount, 100);
assert.equal(calculateDiscount({ discount: discount({ scope: "products", productIds: ["cleanser"], type: "fixed", value: 500 }), products, subtotal: 1200, deliveryFee: 0 }).discountAmount, 200);
assert.match(validateDiscountRecord(discount({ code: "DUP" }), [discount({ code: "dup", id: "another" })]), /already exists/i);
assert.equal(buildIkhokhaPayload({ base: "https://example.com", order: { orderNumber: "LUL-1", total: 930 } }).amount, 93000);
const scheduled = discount({ startsAt: "2026-11-27T00:00", expiresAt: "2026-11-27T23:00", value: 25 });
assert.equal(discountTimestamp(scheduled.startsAt), Date.parse("2026-11-26T22:00:00Z"));
assert.equal(discountTimestamp(scheduled.expiresAt), Date.parse("2026-11-27T21:00:00Z"));
assert.match(validateDiscountRecord({ ...scheduled, expiresAt: "2026-11-26T21:59:00Z" }), /after the start date/);
assert.equal(validateDiscountRecord({ ...scheduled, expiresAt: "2026-11-26T22:01:00Z" }), "");
assert.equal(discountTimestamp("2026-11-26T23:00:00+01:00"), discountTimestamp(scheduled.startsAt));
assert.equal(discountFormTime("2026-11-26T22:00:00Z"), "2026-11-27T00:00:00");
assert.equal(discountFormTime(scheduled.startsAt), scheduled.startsAt);
console.log("Discount calculation tests passed.");
