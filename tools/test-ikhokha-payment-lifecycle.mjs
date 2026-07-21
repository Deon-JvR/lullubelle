import assert from "node:assert/strict";
import { amountsMatch, extractPaylinkId, extractPaymentReference, extractPaymentStatus, extractResponseCode, mapIkhokhaStatus } from "../netlify/functions/ikhokha-checkout.mjs";

assert.equal(mapIkhokhaStatus("paymentLink.paid"), "Paid");
assert.equal(mapIkhokhaStatus("declined"), "Failed");
assert.equal(mapIkhokhaStatus("cancelled"), "Cancelled");
assert.equal(mapIkhokhaStatus("partially_refunded"), "Partially Refunded");
assert.equal(mapIkhokhaStatus("mystery"), "Unknown");
assert.equal(extractPaymentReference({ data: { externalTransactionID: " LUL-1784029406078 " } }), " LUL-1784029406078 ");
assert.equal(extractPaymentStatus({ event: "paymentLink.paid" }), "Paid");
assert.equal(extractPaymentStatus({ Data: { ResponseCode: "00" } }), "Paid");
assert.equal(extractResponseCode({ transaction: { response_code: "00" } }), "00");
assert.equal(amountsMatch(862, 86200), true);
assert.equal(amountsMatch(862, 86100), false);
assert.equal(extractPaylinkId({ paylinkID: "abc123" }), "abc123");
assert.equal(extractPaylinkId({ data: { paylinkId: "xyz789" } }), "xyz789");
assert.equal(extractPaylinkId({ paymentUrl: "https://pay.example/abc" }), "");
console.log("iKhokha payment lifecycle mapping and amount tests passed.");
