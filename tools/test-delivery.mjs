import assert from "node:assert/strict";
import { DOOR_TO_DOOR_FEE, DOOR_TO_DOOR_METHOD, calculateDelivery, normaliseDeliveryMethod, sanitiseDeliverySettings } from "../netlify/functions/_delivery.mjs";

const settings = sanitiseDeliverySettings();
assert.deepEqual(settings, { freeDeliveryThreshold: 1000, standardPudoFee: 80, collectionEnabled: true });
assert.equal(calculateDelivery({ productSubtotal: 999, deliveryOption: "pudo", settings }).deliveryFee, 80);
assert.equal(calculateDelivery({ productSubtotal: 1000, deliveryOption: "pudo", settings }).deliveryFee, 0);
assert.equal(calculateDelivery({ productSubtotal: 1500, deliveryOption: "pudo", settings }).freeDeliveryApplied, true);
assert.equal(calculateDelivery({ productSubtotal: 1100, productDiscount: 150, deliveryOption: "pudo", settings }).deliveryFee, 80);
assert.equal(calculateDelivery({ productSubtotal: 1500, deliveryOption: "collection", settings }).freeDeliveryApplied, false);
assert.equal(calculateDelivery({ productSubtotal: 250, deliveryOption: DOOR_TO_DOOR_METHOD, settings }).deliveryFee, DOOR_TO_DOOR_FEE);
assert.equal(calculateDelivery({ productSubtotal: 2500, deliveryOption: DOOR_TO_DOOR_METHOD, settings }).deliveryFee, 80);
assert.equal(calculateDelivery({ productSubtotal: 2500, deliveryOption: DOOR_TO_DOOR_METHOD, settings }).freeDeliveryApplied, false);
assert.equal(normaliseDeliveryMethod(DOOR_TO_DOOR_METHOD), DOOR_TO_DOOR_METHOD);
assert.throws(() => normaliseDeliveryMethod("browser_supplied_free_delivery"), /Unsupported delivery method/);
console.info("Delivery threshold tests passed.");
