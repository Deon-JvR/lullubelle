import assert from "node:assert/strict";
import { calculateDelivery, sanitiseDeliverySettings } from "../netlify/functions/_delivery.mjs";

const settings = sanitiseDeliverySettings();
assert.deepEqual(settings, { freeDeliveryThreshold: 1000, standardPudoFee: 80, collectionEnabled: true });
assert.equal(calculateDelivery({ productSubtotal: 999, deliveryOption: "pudo", settings }).deliveryFee, 80);
assert.equal(calculateDelivery({ productSubtotal: 1000, deliveryOption: "pudo", settings }).deliveryFee, 0);
assert.equal(calculateDelivery({ productSubtotal: 1500, deliveryOption: "pudo", settings }).freeDeliveryApplied, true);
assert.equal(calculateDelivery({ productSubtotal: 1100, productDiscount: 150, deliveryOption: "pudo", settings }).deliveryFee, 80);
assert.equal(calculateDelivery({ productSubtotal: 1500, deliveryOption: "collection", settings }).freeDeliveryApplied, false);
console.info("Delivery threshold tests passed.");
