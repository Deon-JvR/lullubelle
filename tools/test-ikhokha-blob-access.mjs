import assert from "node:assert/strict";
import { metadataReadOptions } from "../netlify/functions/_admin-shared.mjs";
import { CHECKOUT_BLOB_READ_OPTIONS } from "../netlify/functions/ikhokha-checkout.mjs";

assert.deepEqual(metadataReadOptions(), { type: "json", consistency: "strong" }, "Administrative callers retain strong reads by default.");
assert.deepEqual(CHECKOUT_BLOB_READ_OPTIONS, { strong: false });
assert.deepEqual(
  metadataReadOptions(CHECKOUT_BLOB_READ_OPTIONS),
  { type: "json" },
  "Checkout metadata reads must use the runtime-supported normal consistency mode.",
);
assert.equal("consistency" in metadataReadOptions(CHECKOUT_BLOB_READ_OPTIONS), false);

console.log("iKhokha checkout Blob consistency regression tests passed.");
