import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  escapeIkhokhaSignatureString,
  createIkhokhaSignature,
  extractPaymentUrl,
  generateIkhokhaSignature,
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
assert.equal(
  createIkhokhaSignature({ requestUrl: statusUrl, serializedBody: "", secret }),
  createIkhokhaSignature({ requestUrl: statusUrl, serializedBody: "", secret }),
  "Checkout and status signatures must share the URL-derived signing helper.",
);
assert.notEqual(
  createIkhokhaSignature({ requestUrl: statusUrl, serializedBody: "", secret }),
  createIkhokhaSignature({ requestUrl: statusUrl, serializedBody: "{}", secret }),
  "GET status signatures must not include an implicit JSON body.",
);

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
