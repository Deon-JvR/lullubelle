import assert from "node:assert/strict";
import { ORDER_PROCESSING_NOTICE, buildCustomerOrderConfirmationEmail, requiresPhysicalFulfilment } from "../netlify/functions/_order-processing.mjs";

const product = { id: "cleanser", name: "Cleanser" };
const voucher = { id: "gift-voucher-500", name: "Lullubelle Gift Voucher R500" };

assert.equal(requiresPhysicalFulfilment([product]), true);
assert.equal(requiresPhysicalFulfilment([voucher]), false);
assert.equal(requiresPhysicalFulfilment([voucher, product]), true);

const deliveryEmail = buildCustomerOrderConfirmationEmail({ orderNumber: "LUL-100", products: [product], delivery: { option: "pudo" } });
assert.ok(deliveryEmail.text.includes(ORDER_PROCESSING_NOTICE));
assert.match(deliveryEmail.text, /Delivery transit time begins only after your order has been dispatched\./);

const collectionEmail = buildCustomerOrderConfirmationEmail({ products: [product], delivery: { option: "collection" } });
assert.match(collectionEmail.html, /Collection is available only after we notify you that your order is ready\./);

const voucherEmail = buildCustomerOrderConfirmationEmail({ products: [voucher], delivery: { option: "collection" } });
assert.doesNotMatch(voucherEmail.text, /processed within 5–10 business days/);
assert.doesNotMatch(voucherEmail.html, /processed within 5–10 business days/);

console.log("Order processing notice and confirmation email content tests passed.");
