import assert from "node:assert/strict";
import { ORDERS_KEY, readList, writeList } from "../netlify/functions/_admin-shared.mjs";
import { DISCOUNTS_KEY, sanitiseDiscount } from "../netlify/functions/_discounts.mjs";
import { handler } from "../netlify/functions/ikhokha-checkout.mjs";

process.env.IKHOKHA_API_KEY = "test-app-id";
process.env.IKHOKHA_API_SECRET = "test-api-secret";
process.env.IKHOKHA_TEST_MODE = "true";

const originalFetch = globalThis.fetch;
let providerPayload;
globalThis.fetch = async (_url, options) => {
  providerPayload = JSON.parse(options.body);
  return new Response(JSON.stringify({
    paymentUrl: "https://payments.example.test/lullubelle",
    paylinkID: "test-paylink-door-delivery",
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};

const baseBody = {
  customer: {
    name: "Delivery Customer",
    email: "customer@example.com",
    phone: "+27 82 555 0199",
  },
  deliveryOption: "door_to_door_flat_rate",
  deliveryFee: 0,
  address: {
    streetAddress: "10 Example Street",
    suburb: "Example Park",
    city: "Centurion",
    province: "Gauteng",
    postalCode: "0157",
  },
  items: [{ id: "online-skin-consultation-delivery-test", quantity: 1, price: 1 }],
  finalTotal: 880,
};

const event = (body) => ({
  httpMethod: "POST",
  path: "/.netlify/functions/ikhokha-checkout",
  headers: { host: "localhost:8888", accept: "application/json" },
  queryStringParameters: {},
  body: JSON.stringify(body),
});

try {
  const discount = sanitiseDiscount({ code: "BRANDS25", type: "percentage", value: 25, scope: "brands", brandIds: ["kalahari"] });
  const emailDiscount = sanitiseDiscount({ ...discount, id: "email-offer", code: "FIRST25", firstOrderOnly: true });
  await writeList(DISCOUNTS_KEY, [discount, emailDiscount]);
  const quote = (body) => handler({ ...event(body), queryStringParameters: { action: "validate-promo" } });
  const items = [{ id: "kalahari-skincare-journey-kit-in-travel-bag", quantity: 1 }];
  for (const deliveryOption of ["collection", "pudo", "door_to_door_flat_rate"]) {
    const preview = await quote({ items, deliveryOption, promoCode: discount.code });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(JSON.parse(preview.body).productDiscount, 154.25);
  }
  const anonymous = await quote({ items, promoCode: emailDiscount.code });
  assert.equal(anonymous.statusCode, 400);
  assert.match(JSON.parse(anonymous.body).error, /enter your email/i);
  const identified = await quote({ email: "customer@example.invalid", items, promoCode: emailDiscount.code });
  assert.equal(identified.statusCode, 200, identified.body);
  assert.equal(providerPayload, undefined, "Promo quotes must finish before requesting payment.");
  assert.equal((await readList(ORDERS_KEY)).length, 0);

  const response = await handler(event(baseBody));
  assert.equal(response.statusCode, 200);
  const result = JSON.parse(response.body);
  assert.equal(result.ok, true);

  const order = (await readList(ORDERS_KEY)).find((item) => item.orderNumber === result.orderNumber);
  assert.ok(order, "The created order should persist.");
  assert.equal(order.deliveryMethod, "door_to_door_flat_rate");
  assert.equal(order.delivery.option, "door_to_door_flat_rate");
  assert.equal(order.delivery.label, "Door-to-Door Delivery");
  assert.equal(order.deliveryFee, 80);
  assert.equal(order.delivery.fee, 80);
  assert.equal(order.total, 880);
  assert.equal(providerPayload.amount, 88000);
  assert.deepEqual(order.address, baseBody.address);
  assert.deepEqual(order.customer.address, baseBody.address);
  assert.equal(order.customer.name, baseBody.customer.name);
  assert.equal(order.customer.email, baseBody.customer.email);
  assert.equal(order.customer.phone, baseBody.customer.phone);

  const manipulatedTotal = await handler(event({ ...baseBody, finalTotal: 800, deliveryFee: 0 }));
  assert.equal(manipulatedTotal.statusCode, 400);
  assert.match(JSON.parse(manipulatedTotal.body).error, /total mismatch/i);

  const unsupported = await handler(event({ ...baseBody, deliveryOption: "free_delivery" }));
  assert.equal(unsupported.statusCode, 400);
  assert.match(JSON.parse(unsupported.body).error, /unsupported delivery method/i);

  const missingAddress = await handler(event({ ...baseBody, address: { ...baseBody.address, streetAddress: "   " } }));
  assert.equal(missingAddress.statusCode, 400);
  assert.match(JSON.parse(missingAddress.body).error, /street address/i);

  const invalidCustomer = await handler(event({ ...baseBody, customer: { name: " ", email: "invalid", phone: "12" } }));
  assert.equal(invalidCustomer.statusCode, 400);
  assert.match(JSON.parse(invalidCustomer.body).error, /valid customer name/i);
} finally {
  globalThis.fetch = originalFetch;
}

console.info("Server-authoritative checkout delivery tests passed.");
