import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { generateIkhokhaSignature } from "../netlify/functions/ikhokha-checkout.mjs";

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

const expected = createHmac("sha256", secret)
  .update(`${path}${JSON.stringify(requestBody)}`)
  .digest("hex");

assert.equal(
  generateIkhokhaSignature({ path, requestBody, secret }),
  expected,
  "IK-SIGN must be HMAC_SHA256(path + JSON.stringify(requestBody), IKHOKHA_API_SECRET).",
);

console.info("iKhokha signature test passed.");
