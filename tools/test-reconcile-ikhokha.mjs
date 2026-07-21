import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(tmpdir(), "lullubelle-reconcile-test-"));
const customer = { email: "masked@example.test", phone: "+27 82 000 0000" };
const customerHash = createHash("sha256").update(JSON.stringify({ email: customer.email, phone: "27820000000" })).digest("hex");
const products = [{ id: "product-1", quantity: 1, price: 369 }];
const base = Date.parse("2026-07-21T13:38:41.655Z");
const orders = Array.from({ length: 8 }, (_, index) => ({
  id: `order-${index}`,
  orderNumber: `LUL-${index}`,
  createdAt: new Date(base - index * 2.5 * 60 * 60 * 1000).toISOString(),
  customer,
  products,
  total: 369,
  currency: "ZAR",
  paymentStatus: index === 7 ? "Paid" : "Pending",
  orderStatus: "New",
  ikhokhaPaylinkId: index === 0 ? "paid-paylink" : `unpaid-${index}`,
  externalTransactionID: index === 0 ? "EXT-PAID" : undefined,
}));
const input = { incidentID: "incident-fixture-001", provider: { externalTransactionID: "EXT-PAID", paylinkID: "paid-paylink", amount: 369, currency: "ZAR", timestamp: "2026-07-21T13:40:00Z", maskedCustomerHash: customerHash, duplicateWindowHours: 24 }, snapshot: { ordersBlobETag: "test-orders-etag", orderCount: orders.length }, orders, providerStatuses: orders.map((order, index) => ({ orderNumber: order.orderNumber, status: index === 0 ? "PAID" : "UNPAID" })), sideEffects: orders.map((order) => ({ orderNumber: order.orderNumber, stockEffect: "none", emailEffect: "none", fulfilmentEffect: "none", manualOffPlatformConfirmed: true, evidence: "application has no automated integration and operator confirmed no manual action" })) };
const inputPath = path.join(dir, "input.json");
const reportPath = path.join(dir, "report.json");
await writeFile(inputPath, JSON.stringify(input));
let run = spawnSync(process.execPath, ["tools/reconcile-ikhokha.mjs", "--input", inputPath, "--report", reportPath], { encoding: "utf8" });
assert.equal(run.status, 0, run.stderr || run.stdout);
let report = JSON.parse(await readFile(reportPath));
assert.equal(report.retainedOrder.orderNumber, "[redacted]");
assert.equal(report.retainedOrder.classification, "authoritative-retained-order");
assert.equal(report.duplicateOrders.length, 7);
assert(report.duplicateOrders.every((order) => order.classification === "probable-duplicate"));
assert(report.duplicateOrders.every((order) => order.inclusionReasons.includes("same masked customer hash")));
assert(report.duplicateOrders.every((order) => order.proposedPaymentStatus !== "Paid"));
assert.equal(report.duplicateOrders.find((order) => order.currentPaymentStatus === "Paid").providerStatus, "unpaid");
assert.equal(report.blockers.length, 0);
assert.equal(report.evidenceGate.passed, true);
assert(report.proposedMutations.every((mutation) => mutation.evidence.length && mutation.rollback.procedure));
assert(report.proposedMutations.every((mutation) => mutation.auditEntry?.before && mutation.auditEntry?.after));
assert.equal(report.conditionalWrite.expectedETag, "test-orders-etag");
assert(!run.stdout.includes("EXT-PAID"));
assert(!run.stdout.includes("paid-paylink"));
assert(!run.stdout.includes(customer.email));

const completeInput = structuredClone(input);
delete input.provider.currency;
delete input.provider.timestamp;
delete input.provider.maskedCustomerHash;
input.sideEffects[0].manualOffPlatformConfirmed = false;
await writeFile(inputPath, JSON.stringify(input));
run = spawnSync(process.execPath, ["tools/reconcile-ikhokha.mjs", "--input", inputPath, "--dry-run"], { encoding: "utf8" });
assert.equal(run.status, 2, "Dry-run must remain blocked when currency, timestamp, payer, or manual confirmation is absent.");
report = JSON.parse(run.stdout);
assert.equal(report.evidenceGate.dryRunAllowed, false);
assert(report.blockers.includes("Explicit authoritative provider currency is missing."));
assert(report.blockers.includes("Authoritative payment timestamp is missing or invalid."));
assert(report.blockers.some((blocker) => blocker.startsWith("Provider masked customer hash is missing")));
assert(report.blockers.some((blocker) => blocker.includes("Side-effect evidence is incomplete")));

Object.assign(input, completeInput);
await writeFile(inputPath, JSON.stringify(input));
run = spawnSync(process.execPath, ["tools/reconcile-ikhokha.mjs", "--input", inputPath, "--dry-run"], { encoding: "utf8" });
assert.equal(run.status, 0, run.stderr || run.stdout);
report = JSON.parse(run.stdout);
assert.equal(report.evidenceGate.dryRunAllowed, true, "All authoritative and operator confirmations should open the reviewed dry-run gate.");

input.orders[1].externalTransactionID = "EXT-PAID";
await writeFile(inputPath, JSON.stringify(input));
run = spawnSync(process.execPath, ["tools/reconcile-ikhokha.mjs", "--input", inputPath], { encoding: "utf8" });
assert.equal(run.status, 2);
report = JSON.parse(run.stdout);
assert(report.blockers.some((blocker) => blocker.includes("exactly one")));

delete input.orders[1].externalTransactionID;
delete input.provider.maskedCustomerHash;
await writeFile(inputPath, JSON.stringify(input));
run = spawnSync(process.execPath, ["tools/reconcile-ikhokha.mjs", "--input", inputPath], { encoding: "utf8" });
assert.equal(run.status, 2);
report = JSON.parse(run.stdout);
assert(report.blockers.some((blocker) => blocker.startsWith("Provider masked customer hash is missing")));

run = spawnSync(process.execPath, ["tools/reconcile-ikhokha.mjs"], { encoding: "utf8", env: { ...process.env, NETLIFY_AUTH_TOKEN: "" } });
assert.equal(run.status, 2, "No-argument invocation must stop without mutation.");
assert.match(run.stderr, /Usage:/);

completeInput.provider.maskedCustomerHash = customerHash;
await writeFile(inputPath, JSON.stringify(completeInput));
run = spawnSync(process.execPath, ["tools/reconcile-ikhokha.mjs", "--input", inputPath, "--apply"], { encoding: "utf8", env: { ...process.env, NETLIFY_AUTH_TOKEN: "" } });
assert.notEqual(run.status, 0, "--apply without --confirm-apply must stop before authenticated access.");
assert.match(run.stderr, /require --confirm-apply/);

run = spawnSync(process.execPath, ["tools/reconcile-ikhokha.mjs", "--input", inputPath, "--confirm-apply"], { encoding: "utf8", env: { ...process.env, NETLIFY_AUTH_TOKEN: "" } });
assert.equal(run.status, 0, "--confirm-apply without --apply must remain read-only.");
assert.equal(JSON.parse(run.stdout).evidenceGate.applyAllowed, false);

run = spawnSync(process.execPath, ["tools/reconcile-ikhokha.mjs", "--input", inputPath, "--apply", "--confirm-apply", "--incident-id", "wrong-incident", "--allow-orders", orders.map((order) => order.orderNumber).join(",")], { encoding: "utf8", env: { ...process.env, NETLIFY_AUTH_TOKEN: "" } });
assert.notEqual(run.status, 0, "A mismatched incident ID must stop before authenticated access.");
assert.match(run.stderr, /incident-id must exactly match/);

run = spawnSync(process.execPath, ["tools/reconcile-ikhokha.mjs", "--input", inputPath, "--apply", "--confirm-apply", "--incident-id", completeInput.incidentID, "--allow-orders", orders.slice(0, 7).map((order) => order.orderNumber).join(",")], { encoding: "utf8", env: { ...process.env, NETLIFY_AUTH_TOKEN: "" } });
assert.notEqual(run.status, 0, "An incomplete allowlist must stop before authenticated access.");
assert.match(run.stderr, /allow-orders must exactly equal/);

const changedProvider = structuredClone(completeInput);
changedProvider.providerStatuses[0].status = "UNPAID";
await writeFile(inputPath, JSON.stringify(changedProvider));
run = spawnSync(process.execPath, ["tools/reconcile-ikhokha.mjs", "--input", inputPath, "--dry-run"], { encoding: "utf8", env: { ...process.env, NETLIFY_AUTH_TOKEN: "" } });
assert.equal(run.status, 2);
assert(JSON.parse(run.stdout).blockers.includes("The authoritative retained order is not currently provider-paid."));

const uncertainSideEffects = structuredClone(completeInput);
uncertainSideEffects.sideEffects[0].emailEffect = "unknown";
await writeFile(inputPath, JSON.stringify(uncertainSideEffects));
run = spawnSync(process.execPath, ["tools/reconcile-ikhokha.mjs", "--input", inputPath, "--dry-run"], { encoding: "utf8", env: { ...process.env, NETLIFY_AUTH_TOKEN: "" } });
assert.equal(run.status, 2);
assert(JSON.parse(run.stdout).blockers.some((blocker) => blocker.includes("Side-effect evidence")));

const recordedSideEffects = structuredClone(completeInput);
recordedSideEffects.orders[0].confirmationEmailSent = true;
await writeFile(inputPath, JSON.stringify(recordedSideEffects));
run = spawnSync(process.execPath, ["tools/reconcile-ikhokha.mjs", "--input", inputPath, "--dry-run"], { encoding: "utf8", env: { ...process.env, NETLIFY_AUTH_TOKEN: "" } });
assert.equal(run.status, 2);
assert(JSON.parse(run.stdout).blockers.some((blocker) => blocker.includes("Recorded automated side effects")));

const wrongCount = structuredClone(completeInput);
wrongCount.snapshot.orderCount += 1;
await writeFile(inputPath, JSON.stringify(wrongCount));
run = spawnSync(process.execPath, ["tools/reconcile-ikhokha.mjs", "--input", inputPath, "--dry-run"], { encoding: "utf8", env: { ...process.env, NETLIFY_AUTH_TOKEN: "" } });
assert.equal(run.status, 2);
assert(JSON.parse(run.stdout).blockers.includes("Snapshot order count is missing or does not match the evidence order set."));

delete input.provider.maskedCustomerHash;
input.provider.payerIdentifierUnavailable = true;
input.provider.saleID = "SALE-FIXTURE-001";
input.provider.receiptNumber = "RECEIPT-FIXTURE-001";
input.provider.invoiceItemReference = "EXT-PAID";
input.provider.status = "APPROVED";
input.provider.lookupStatus = "PAID";
await writeFile(inputPath, JSON.stringify(input));
run = spawnSync(process.execPath, ["tools/reconcile-ikhokha.mjs", "--input", inputPath, "--dry-run"], { encoding: "utf8" });
assert.equal(run.status, 0, run.stderr || run.stdout);
report = JSON.parse(run.stdout);
assert.equal(report.evidenceGate.passed, true, "A complete invoice and successful provider-lookup chain may substitute for an unavailable masked payer identifier.");
assert.equal(report.evidence.payerEvidence, "independent-provider-invoice-and-lookup-chain");
assert.equal(report.audit.evidence.payerEvidenceSubstitutedByIndependentProviderChain, true);

input.provider.invoiceItemReference = "DIFFERENT-ORDER";
await writeFile(inputPath, JSON.stringify(input));
run = spawnSync(process.execPath, ["tools/reconcile-ikhokha.mjs", "--input", inputPath], { encoding: "utf8" });
assert.equal(run.status, 2, "An invoice for a different item reference must not substitute for payer evidence.");
report = JSON.parse(run.stdout);
assert(report.blockers.some((blocker) => blocker.startsWith("Provider masked customer hash is missing")));

console.log("iKhokha reconciliation incident-shape tests passed.");
