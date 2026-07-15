import assert from "node:assert/strict";
import { amountsMatch, extractPaymentReference, extractPaymentStatus, mapIkhokhaStatus } from "../netlify/functions/ikhokha-checkout.mjs";

assert.equal(mapIkhokhaStatus("paymentLink.paid"), "Paid");
assert.equal(mapIkhokhaStatus("declined"), "Failed");
assert.equal(mapIkhokhaStatus("cancelled"), "Cancelled");
assert.equal(mapIkhokhaStatus("partially_refunded"), "Partially Refunded");
assert.equal(mapIkhokhaStatus("mystery"), "Unknown");
assert.equal(extractPaymentReference({ data: { externalTransactionID: " LUL-1784029406078 " } }), " LUL-1784029406078 ");
assert.equal(extractPaymentStatus({ event: "paymentLink.paid" }), "Paid");
assert.equal(amountsMatch(862, 86200), true);
assert.equal(amountsMatch(862, 86100), false);
console.log("iKhokha payment lifecycle mapping and amount tests passed.");
