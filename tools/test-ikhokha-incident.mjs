import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { ORDERS_KEY, readList } from "../netlify/functions/_admin-shared.mjs";
import { handler } from "../netlify/functions/ikhokha-checkout.mjs";

process.env.IKHOKHA_API_KEY = "incident-test-app";
process.env.IKHOKHA_API_SECRET = "incident-test-secret";
process.env.IKHOKHA_TEST_MODE = "true";

const originalFetch = globalThis.fetch;
let checkoutCalls = 0;
globalThis.fetch = async (_url, options) => {
  checkoutCalls += 1;
  const request = JSON.parse(options.body);
  return new Response(JSON.stringify({ paymentUrl: "https://pay.example/incident", paylinkID: "paylink-incident", externalTransactionID: request.externalTransactionID }), { status: 200, headers: { "content-type": "application/json" } });
};

const body = {
  paymentAttemptId: "incident-attempt-1",
  customer: { name: "Incident Customer", email: "incident@example.test", phone: "+27825550199" },
  deliveryOption: "collection",
  items: [{ id: "online-skin-consultation-incident", quantity: 1 }],
  finalTotal: 800,
};
const checkoutEvent = () => ({ httpMethod: "POST", path: "/.netlify/functions/ikhokha-checkout", headers: { host: "localhost:8888", accept: "application/json", "content-type": "application/json" }, queryStringParameters: {}, body: JSON.stringify(body) });

try {
  const responses = await Promise.all(Array.from({ length: 10 }, () => handler(checkoutEvent())));
  assert.equal(responses.some((response) => response.statusCode === 200), true);
  const first = JSON.parse(responses.find((response) => response.statusCode === 200).body);
  const matching = (await readList(ORDERS_KEY)).filter((order) => order.paymentAttemptId === body.paymentAttemptId);
  assert.equal(matching.length, 1, "Ten submissions must create one order.");
  assert.equal(checkoutCalls, 1, "Ten submissions must create one PayLink.");
  assert.equal(matching[0].externalTransactionID, first.externalTransactionID);

  const callbackBody = JSON.stringify({ Data: { ExternalTransactionID: first.externalTransactionID, PaylinkID: "paylink-incident", ResponseCode: "00", Amount: 80000, Currency: "ZAR", TransactionID: "tx-incident" } });
  const signature = createHmac("sha256", process.env.IKHOKHA_API_SECRET).update(Buffer.from(callbackBody)).digest("hex");
  const callback = () => handler({ httpMethod: "POST", path: "/.netlify/functions/ikhokha-checkout", headers: { "content-type": "application/json", "x-ikhokha-signature": signature }, queryStringParameters: { action: "confirm", order: "wrong-fallback-order" }, body: callbackBody });
  const [confirmed, duplicate] = await Promise.all([callback(), callback()]);
  assert.equal(confirmed.statusCode, 200);
  assert.equal(duplicate.statusCode, 200);
  let paid = (await readList(ORDERS_KEY)).find((order) => order.externalTransactionID === first.externalTransactionID);
  assert.equal(paid.paymentStatus, "Paid");
  assert.equal(paid.responseCode, "00");
  assert.equal(paid.paymentEvents.filter((event) => event.idempotencyKey === "tx-incident").length, 1);

  const failedBody = JSON.stringify({ externalTransactionID: first.externalTransactionID, paylinkID: "paylink-incident", status: "failed", amount: 80000, currency: "ZAR", transactionID: "tx-late" });
  const failedSignature = createHmac("sha256", process.env.IKHOKHA_API_SECRET).update(Buffer.from(failedBody)).digest("hex");
  await handler({ httpMethod: "POST", path: "/.netlify/functions/ikhokha-checkout", headers: { "content-type": "application/json", "x-ikhokha-signature": failedSignature }, queryStringParameters: { action: "confirm" }, body: failedBody });
  paid = (await readList(ORDERS_KEY)).find((order) => order.externalTransactionID === first.externalTransactionID);
  assert.equal(paid.paymentStatus, "Paid", "A delayed failed callback must not overwrite paid.");

  const paidRetry = await handler(checkoutEvent());
  assert.equal(paidRetry.statusCode, 409);
  assert.equal(JSON.parse(paidRetry.body).code, "ORDER_ALREADY_PAID");
} finally {
  globalThis.fetch = originalFetch;
}

console.info("iKhokha P0 incident idempotency tests passed.");
