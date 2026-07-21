import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { ORDERS_KEY, readList } from "../netlify/functions/_admin-shared.mjs";
import { escapeIkhokhaSignatureString, handler, verifyIkhokhaCallbackSignature } from "../netlify/functions/ikhokha-checkout.mjs";

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

  const callbackPayload = { paylinkID: "paylink-incident", status: "SUCCESS", externalTransactionID: first.externalTransactionID, responseCode: "00", amount: 80000, currency: "ZAR", transactionID: "tx-incident" };
  const callbackBody = JSON.stringify(callbackPayload);
  const callbackPath = "/.netlify/functions/ikhokha-checkout";
  const signature = createHmac("sha256", process.env.IKHOKHA_API_SECRET).update(escapeIkhokhaSignatureString(`${callbackPath}${callbackBody}`)).digest("hex");
  const callbackEvent = () => ({ httpMethod: "POST", rawUrl: `https://www.lullubelle.co.za${callbackPath}?action=confirm&order=wrong-fallback-order`, path: callbackPath, headers: { "Content-Type": "application/json; charset=utf-8", "IK-APPID": process.env.IKHOKHA_API_KEY, "IK-SIGN": signature }, queryStringParameters: { action: "confirm", order: "wrong-fallback-order" }, body: callbackBody });
  const tampered = callbackEvent();
  tampered.body = callbackBody.replace("80000", "80100");
  assert.equal(verifyIkhokhaCallbackSignature(tampered), false, "A callback whose signed body was changed must fail authentication.");
  assert.equal((await handler(tampered)).statusCode, 401, "A tampered callback must be rejected before any provider or order operation.");
  assert.equal((await readList(ORDERS_KEY)).find((order) => order.externalTransactionID === first.externalTransactionID).paymentStatus, "Pending");
  const callback = () => handler(callbackEvent());
  const [confirmed, duplicate] = await Promise.all([callback(), callback()]);
  assert.equal(confirmed.statusCode, 200);
  assert.equal(duplicate.statusCode, 200);
  assert.equal((await readList(ORDERS_KEY)).filter((order) => order.paymentAttemptId === body.paymentAttemptId).length, 1, "A valid callback must update the existing order and never create another order.");
  let paid = (await readList(ORDERS_KEY)).find((order) => order.externalTransactionID === first.externalTransactionID);
  assert.equal(paid.paymentStatus, "Paid");
  assert.equal(paid.responseCode, "00");
  assert.equal(paid.paymentEvents.filter((event) => event.idempotencyKey === "tx-incident").length, 1);

  const failedBody = JSON.stringify({ externalTransactionID: first.externalTransactionID, paylinkID: "paylink-incident", status: "failed", amount: 80000, currency: "ZAR", transactionID: "tx-late" });
  const failedSignature = createHmac("sha256", process.env.IKHOKHA_API_SECRET).update(escapeIkhokhaSignatureString(`${callbackPath}${failedBody}`)).digest("hex");
  await handler({ httpMethod: "POST", path: callbackPath, headers: { "content-type": "application/json", "ik-appid": process.env.IKHOKHA_API_KEY, "ik-sign": failedSignature }, queryStringParameters: { action: "confirm" }, body: failedBody });
  paid = (await readList(ORDERS_KEY)).find((order) => order.externalTransactionID === first.externalTransactionID);
  assert.equal(paid.paymentStatus, "Paid", "A delayed failed callback must not overwrite paid.");

  const paidRetry = await handler(checkoutEvent());
  assert.equal(paidRetry.statusCode, 409);
  assert.equal(JSON.parse(paidRetry.body).code, "ORDER_ALREADY_PAID");

  const formPayload = { ...callbackPayload, externalTransactionID: "LUL-FORM-FIXTURE", text: "provider display text" };
  const formBody = new URLSearchParams(formPayload).toString();
  const canonicalFormPayload = Object.fromEntries(new URLSearchParams(formBody));
  delete canonicalFormPayload.text;
  const formSignature = createHmac("sha256", process.env.IKHOKHA_API_SECRET).update(escapeIkhokhaSignatureString(`${callbackPath}${JSON.stringify(canonicalFormPayload)}`)).digest("hex");
  const formEvent = { httpMethod: "POST", path: callbackPath, headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "Ik-AppId": process.env.IKHOKHA_API_KEY, "Ik-Sign": formSignature }, queryStringParameters: { action: "confirm" }, body: formBody };
  assert.equal(verifyIkhokhaCallbackSignature(formEvent), true, "Documented form parsing must canonicalise fields before signature verification.");
  const base64Event = { ...callbackEvent(), isBase64Encoded: true, body: Buffer.from(callbackBody).toString("base64") };
  assert.equal(verifyIkhokhaCallbackSignature(base64Event), true, "Netlify base64 body transport must preserve callback verification.");
  const wrongApp = callbackEvent();
  wrongApp.headers["IK-APPID"] = "different-app";
  assert.equal(verifyIkhokhaCallbackSignature(wrongApp), false, "A valid HMAC from the wrong application ID must be rejected.");
  assert.equal((await handler(wrongApp)).statusCode, 401);
  const wrongHmac = callbackEvent();
  wrongHmac.headers["IK-SIGN"] = "0".repeat(64);
  assert.equal(verifyIkhokhaCallbackSignature(wrongHmac), false, "An incorrect HMAC must be rejected.");
  assert.equal((await handler(wrongHmac)).statusCode, 401);
  const missingSignature = callbackEvent();
  delete missingSignature.headers["IK-SIGN"];
  assert.equal(verifyIkhokhaCallbackSignature(missingSignature), false, "A missing callback signature must be rejected.");
  assert.equal((await handler(missingSignature)).statusCode, 401);
  const missingApp = callbackEvent();
  delete missingApp.headers["IK-APPID"];
  assert.equal(verifyIkhokhaCallbackSignature(missingApp), false, "A missing application ID must be rejected.");
  assert.equal((await handler(missingApp)).statusCode, 401);

  const signedCallback = (payload) => {
    const bodyText = JSON.stringify(payload);
    const hmac = createHmac("sha256", process.env.IKHOKHA_API_SECRET).update(escapeIkhokhaSignatureString(`${callbackPath}${bodyText}`)).digest("hex");
    return { httpMethod: "POST", path: callbackPath, headers: { "content-type": "application/json", "ik-appid": process.env.IKHOKHA_API_KEY, "ik-sign": hmac }, queryStringParameters: { action: "confirm" }, body: bodyText };
  };
  const amountMismatch = await handler(signedCallback({ ...callbackPayload, amount: 80100, transactionID: "tx-amount-mismatch" }));
  assert.equal(amountMismatch.statusCode, 409, "A validly signed amount mismatch must be rejected.");
  const paylinkMismatch = await handler(signedCallback({ ...callbackPayload, paylinkID: "different-paylink", transactionID: "tx-paylink-mismatch" }));
  assert.equal(paylinkMismatch.statusCode, 409, "A validly signed PayLink mismatch must be rejected.");
  const unknownOrder = await handler(signedCallback({ ...callbackPayload, externalTransactionID: "LUL-UNKNOWN", transactionID: "tx-unknown" }));
  assert.equal(unknownOrder.statusCode, 404, "A validly signed callback for an unknown identifier must be rejected.");
  const alreadyPaid = await handler(callbackEvent());
  assert.equal(alreadyPaid.statusCode, 200, "A repeated valid callback for an already Paid order must remain idempotent.");
  paid = (await readList(ORDERS_KEY)).find((order) => order.externalTransactionID === first.externalTransactionID);
  assert.equal(paid.paymentEvents.filter((event) => event.idempotencyKey === "tx-incident").length, 1);
} finally {
  globalThis.fetch = originalFetch;
}

console.info("iKhokha P0 incident idempotency tests passed.");
