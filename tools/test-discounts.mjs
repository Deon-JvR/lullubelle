import assert from "node:assert/strict";
import { calculateDiscount, normalisePromoCode, sanitiseDiscount, validateDiscountRecord } from "../netlify/functions/_discounts.mjs";
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
console.log("Discount calculation tests passed.");
