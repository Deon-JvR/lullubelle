import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  escapeIkhokhaSignatureString,
  createIkhokhaSignature,
  createIkhokhaSignedRequest,
  extractPaymentUrl,
  generateIkhokhaSignature,
  ikhokhaRequestParts,
} from "../netlify/functions/ikhokha-checkout.mjs";

const path = "/public-api/v1/api/payment";
const secret = "test-application-key-secret";
const requestBody = {
  amount: 34700,
  currency: "ZAR",
  externalTransactionID: "LUL-TEST-347",
  description: "Lullubelle order LUL-TEST-347",
  entityID: "test-application-key-id",
  mode: "test",
  requesterUrl: "https://www.lullubelle.co.za",
  urls: {
    callbackUrl: "https://www.lullubelle.co.za/.netlify/functions/ikhokha-checkout?action=confirm&order=LUL-TEST-347",
    successPageUrl: "https://www.lullubelle.co.za/payment-success?order=LUL-TEST-347",
    failurePageUrl: "https://www.lullubelle.co.za/payment-cancelled?order=LUL-TEST-347",
    cancelUrl: "https://www.lullubelle.co.za/payment-cancelled?order=LUL-TEST-347",
  },
};
const requestBodyString = JSON.stringify(requestBody);
const payloadToSign = `${path}${requestBodyString}`;

const expected = createHmac("sha256", secret)
  .update(escapeIkhokhaSignatureString(payloadToSign))
  .digest("hex");

assert.equal(
  generateIkhokhaSignature({ path, requestBodyString, secret: ` ${secret} ` }),
  expected,
  "IK-SIGN must be HMAC_SHA256(escaped path + exact requestBodyString, trimmed IKHOKHA_API_SECRET).",
);
const statusUrl = "https://api.ikhokha.com/public-api/v1/api/getStatus/external?externalReference=LUL-TEST";
const correctedStatus = createIkhokhaSignedRequest({ requestUrl: statusUrl, serializedBody: "", secret, method: "GET" });
const expectedStatusBase = "/public-api/v1/api/getStatus/external";
const expectedStatusSignature = createHmac("sha256", secret).update(escapeIkhokhaSignatureString(expectedStatusBase)).digest("hex");
assert.equal(
  correctedStatus.signature,
  expectedStatusSignature,
  "Query-based status signing must exclude the query string from the signature pathname.",
);
assert.equal(correctedStatus.requestUrl, statusUrl);
assert.equal(correctedStatus.pathname, expectedStatusBase);
assert.equal(correctedStatus.query, "?externalReference=LUL-TEST");
const oldIncorrectSignature = createHmac("sha256", secret).update(escapeIkhokhaSignatureString(`${expectedStatusBase}?externalReference=LUL-TEST`)).digest("hex");
assert.notEqual(oldIncorrectSignature, correctedStatus.signature, "The previous query-inclusive signature must fail the corrected expectation.");
assert.notEqual(
  createIkhokhaSignature({ requestUrl: statusUrl, serializedBody: "", secret }),
  createIkhokhaSignature({ requestUrl: statusUrl, serializedBody: "{}", secret }),
  "GET status signatures must not include an implicit JSON body.",
);

const directStatus = createIkhokhaSignedRequest({ requestUrl: "https://api.ikhokha.com/public-api/v1/api/getStatus/paylink%2Fencoded", secret });
assert.equal(directStatus.pathname, "/public-api/v1/api/getStatus/paylink%2Fencoded");
assert.equal(directStatus.query, "");
const history = createIkhokhaSignedRequest({ requestUrl: "https://api.ikhokha.com/public-api/v1/api/payments/history?startDate=2026-07-20&endDate=2026-07-22", secret });
assert.equal(history.pathname, "/public-api/v1/api/payments/history");
assert.equal(history.query, "?startDate=2026-07-20&endDate=2026-07-22");
const encoded = createIkhokhaSignedRequest({ requestUrl: "https://api.ikhokha.com/public-api/v1/api/getStatus/external?externalReference=LUL-TEST%20A%2FB", secret });
assert.equal(encoded.pathname, expectedStatusBase);
assert(encoded.requestUrl.includes("externalReference=LUL-TEST%20A%2FB"));
assert.equal(encoded.signature, expectedStatusSignature);
assert.deepEqual(ikhokhaRequestParts({ requestUrl: statusUrl, method: "get", timestamp: "ignored-by-provider-rule" }), {
  requestUrl: statusUrl,
  pathname: expectedStatusBase,
  query: "?externalReference=LUL-TEST",
  serializedBody: "",
  method: "GET",
  timestamp: "ignored-by-provider-rule",
});

assert.equal(
  extractPaymentUrl({
    transactionId: "tx_123",
    data: {
      paymentLinkUrl: "https://pay.ikhokha.com/link/tx_123",
    },
  }),
  "https://pay.ikhokha.com/link/tx_123",
  "The checkout parser should detect a hosted iKhokha payment URL from nested response data.",
);

assert.equal(
  extractPaymentUrl({
    urls: {
      successPageUrl: "https://www.lullubelle.co.za/payment-success?order=LUL-TEST",
      cancelUrl: "https://www.lullubelle.co.za/payment-cancelled?order=LUL-TEST",
    },
    payment: {
      redirectUrl: "https://pay.ikhokha.com/session/tx_123",
    },
  }),
  "https://pay.ikhokha.com/session/tx_123",
  "The checkout parser should not mistake echoed success/cancel URLs for the hosted payment URL.",
);

console.info("iKhokha signature and response parser tests passed.");
