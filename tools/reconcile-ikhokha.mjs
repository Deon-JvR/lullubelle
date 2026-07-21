#!/usr/bin/env node
/*
 * Controlled operator tool. Input is a read-only evidence export. Provider
 * identifiers may select the retained order; secondary evidence may only
 * explain and group probable duplicates.
 */
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getStore } from "@netlify/blobs";

const argv = process.argv.slice(2);
const args = new Set(argv);
const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : "";
};
const inputPath = valueAfter("--input");
if (!inputPath) {
  console.error("Usage: node tools/reconcile-ikhokha.mjs --input export.json [--report out.json] [--dry-run] [--apply --confirm-apply --incident-id ID --allow-orders ID,ID]");
  process.exit(2);
}
const input = JSON.parse(await readFile(inputPath, "utf8"));
const provider = input.provider || {};
const orders = Array.isArray(input.orders) ? input.orders : [];
const normal = (value) => String(value || "").trim().toLowerCase();
const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const external = String(provider.externalTransactionID || "").trim();
const paylink = String(provider.paylinkID || "").trim();
const amount = Number(provider.amount);
const currency = String(provider.currency || "").toUpperCase();
const paidAt = String(provider.timestamp || provider.paidAt || "").trim();
const incidentID = String(input.incidentID || "").trim();
assert(external || paylink, "provider.externalTransactionID or provider.paylinkID is required");

const amountMatches = (order) => Math.abs(Number(order.total) - amount) <= 0.01 || Math.abs(Number(order.total) * 100 - amount) <= 1;
const currencyMatches = (order) => String(order.currency || "ZAR").toUpperCase() === currency;
const byExternal = external ? orders.filter((order) => normal(order.externalTransactionID || order.orderNumber) === normal(external)) : [];
const byPaylink = paylink ? orders.filter((order) => String(order.ikhokhaPaylinkId || order.paylinkID || "") === paylink) : [];
const authoritativePool = byExternal.length ? byExternal : byPaylink;
const authoritativeReason = byExternal.length ? "externalTransactionID" : byPaylink.length ? "paylinkID" : null;
const authoritativeExact = authoritativePool.filter((order) => amountMatches(order) && (!currency || currencyMatches(order)));
const retained = authoritativeExact.length === 1 ? authoritativeExact[0] : null;

const itemIdentity = (item) => normal(item.id || item.sku || item.productId || item.name);
const basketFingerprint = (order) => createHash("sha256").update(JSON.stringify(
  (Array.isArray(order.products) ? order.products : [])
    .map((item) => [itemIdentity(item), Number(item.quantity) || 0])
    .sort(([a], [b]) => a.localeCompare(b)),
)).digest("hex");
const customerHash = (order) => createHash("sha256").update(JSON.stringify({
  email: normal(order.customer?.email),
  phone: String(order.customer?.phone || "").replace(/\D/g, ""),
})).digest("hex");
const providerCustomerHash = normal(provider.maskedCustomerHash || provider.customerHash);
const providerStatus = normal(provider.status || provider.paymentStatus);
const providerLookupStatus = normal(provider.lookupStatus || provider.providerLookupStatus);
const invoiceItemReference = String(provider.invoiceItemReference || provider.itemReference || "").trim();
const independentPayerSubstitute = Boolean(
  provider.payerIdentifierUnavailable === true
  && String(provider.saleID || "").trim()
  && String(provider.receiptNumber || provider.transactionID || "").trim()
  && invoiceItemReference
  && normal(invoiceItemReference) === normal(external)
  && ["approved", "paid"].includes(providerStatus)
  && providerLookupStatus === "paid"
);
const retainedCustomerHash = retained ? customerHash(retained) : "";
const retainedBasket = retained ? basketFingerprint(retained) : "";
const anchorTime = Date.parse(paidAt || retained?.createdAt || "");
const windowHours = Number(provider.duplicateWindowHours || input.duplicateWindowHours || 24);
const withinWindow = (order) => {
  const created = Date.parse(String(order.createdAt || ""));
  return Number.isFinite(anchorTime) && Number.isFinite(created) && Math.abs(created - anchorTime) <= windowHours * 60 * 60 * 1000;
};
const relatedAttempt = (order) => Boolean(retained && order !== retained && (
  (retained.paymentAttemptId && order.paymentAttemptId === retained.paymentAttemptId)
  || (retained.checkoutFingerprint && order.checkoutFingerprint === retained.checkoutFingerprint)
  || (Array.isArray(input.attempts) && input.attempts.some((attempt) => {
    const value = attempt.data || attempt.value || attempt;
    const references = [value.orderNumber, value.externalTransactionID].map(normal);
    return references.includes(normal(retained.orderNumber)) && references.includes(normal(order.orderNumber));
  }))
));

const classifiedOrders = orders.map((order) => {
  if (order === retained) return { order, classification: "authoritative-retained-order", reasons: [`matched ${authoritativeReason}`, "amount matched", "currency matched"] };
  const reasons = [];
  if (retained && basketFingerprint(order) === retainedBasket) reasons.push("same normalised basket fingerprint");
  if (amountMatches(order)) reasons.push("same amount");
  if (currencyMatches(order)) reasons.push("same currency");
  if (retained && customerHash(order) === retainedCustomerHash) reasons.push("same masked customer hash");
  if (withinWindow(order)) reasons.push(`within ${windowHours}-hour creation window`);
  if (relatedAttempt(order)) reasons.push("related payment-attempt/session identifier");
  const completeSecondary = ["same normalised basket fingerprint", "same amount", "same currency", "same masked customer hash"]
    .every((reason) => reasons.includes(reason)) && reasons.some((reason) => reason.includes("creation window"));
  return { order, classification: completeSecondary || relatedAttempt(order) ? "probable-duplicate" : "unrelated-order", reasons };
});
const duplicates = classifiedOrders.filter((entry) => entry.classification === "probable-duplicate");
const unrelated = classifiedOrders.filter((entry) => entry.classification === "unrelated-order");
const providerStatuses = new Map((Array.isArray(input.providerStatuses) ? input.providerStatuses : []).map((entry) => [normal(entry.orderNumber), normal(entry.status)]));
const sideEffectEvidence = new Map((Array.isArray(input.sideEffects) ? input.sideEffects : []).map((entry) => [normal(entry.orderNumber), entry]));
const ordersBlobETag = String(input.snapshot?.ordersBlobETag || "").trim();
const expectedOrderCount = Number(input.snapshot?.orderCount);
const blockers = [];
if (!incidentID) blockers.push("A reviewed incident ID is required.");
if (!Number.isInteger(expectedOrderCount) || expectedOrderCount < 1 || orders.length !== expectedOrderCount) blockers.push("Snapshot order count is missing or does not match the evidence order set.");
if (!authoritativeReason) blockers.push("No order matches an authoritative externalTransactionID or paylinkID.");
if (!Number.isFinite(amount)) blockers.push("Authoritative provider amount is missing or invalid.");
if (!currency) blockers.push("Explicit authoritative provider currency is missing.");
if (authoritativeExact.length !== 1) blockers.push(`Authoritative identifiers resolve to ${authoritativeExact.length} amount/currency-matching orders; exactly one is required.`);
if (byExternal.length && byPaylink.length && !byExternal.some((order) => byPaylink.includes(order))) blockers.push("externalTransactionID and paylinkID identify different orders.");
if (providerCustomerHash && retained && providerCustomerHash !== retainedCustomerHash) blockers.push("Provider masked customer hash does not match the retained order.");
if (!providerCustomerHash && !independentPayerSubstitute) blockers.push("Provider masked customer hash is missing and no complete independent invoice/lookup evidence chain substitutes for it.");
if (!paidAt || !Number.isFinite(Date.parse(paidAt))) blockers.push("Authoritative payment timestamp is missing or invalid.");
if (!ordersBlobETag) blockers.push("Snapshot orders Blob ETag is missing; a reviewed conditional write cannot be prepared safely.");
if (retained && providerStatuses.get(normal(retained.orderNumber)) !== "paid") blockers.push("The authoritative retained order is not currently provider-paid.");
if (duplicates.some(({ order }) => !["unpaid", "failed", "cancelled"].includes(providerStatuses.get(normal(order.orderNumber))))) blockers.push("At least one probable duplicate is not conclusively provider-unpaid.");
if (duplicates.some(({ order }) => ["paid", "refunded", "partially refunded"].includes(normal(order.paymentStatus)) && !["unpaid", "failed", "cancelled"].includes(providerStatuses.get(normal(order.orderNumber))))) blockers.push("A probable duplicate has a terminal local payment state without authoritative provider evidence that it is unpaid.");
if (classifiedOrders.some(({ classification, reasons }) => classification === "unrelated-order" && reasons.filter((reason) => reason.startsWith("same ")).length >= 3)) blockers.push("At least one near-match falls outside the duplicate window and requires operator review.");
const clusterOrders = [retained, ...duplicates.map(({ order }) => order)].filter(Boolean);
for (const order of clusterOrders) {
  const evidence = sideEffectEvidence.get(normal(order.orderNumber));
  if (!evidence || !["stockEffect", "emailEffect", "fulfilmentEffect"].every((field) => normal(evidence[field]) === "none") || evidence.manualOffPlatformConfirmed !== true) blockers.push(`Side-effect evidence is incomplete or non-empty for ${order.orderNumber}.`);
  if ((Array.isArray(order.stockMovements) && order.stockMovements.length) || order.confirmationEmailSent === true || (order.fulfilmentState != null && String(order.fulfilmentState).trim())) blockers.push(`Recorded automated side effects are present for ${order.orderNumber}.`);
}

const sideEffect = (order) => ({
  stockMovements: Array.isArray(order.stockMovements) ? order.stockMovements : [],
  confirmationEmailSent: order.confirmationEmailSent ?? null,
  fulfilmentState: order.fulfilmentState ?? null,
});
const orderSummary = ({ order, classification, reasons }) => ({
  orderNumber: order.orderNumber,
  id: order.id,
  classification,
  inclusionReasons: reasons,
  currentOrderStatus: order.orderStatus,
  proposedOrderStatus: classification === "authoritative-retained-order" ? (normal(order.orderStatus) === "new" ? "Processing" : order.orderStatus) : "Duplicate/Cancelled",
  currentPaymentStatus: order.paymentStatus,
  proposedPaymentStatus: classification === "authoritative-retained-order" ? "Paid" : "Duplicate/Cancelled",
  providerStatus: providerStatuses.get(normal(order.orderNumber)) || null,
  sideEffects: { ...sideEffect(order), evidence: sideEffectEvidence.get(normal(order.orderNumber)) || null },
});
const mutationFor = (entry) => {
  const summary = orderSummary(entry);
  const retainedMutation = entry.classification === "authoritative-retained-order";
  return {
    orderNumber: entry.order.orderNumber,
    classification: entry.classification,
    proposedChanges: {
      paymentStatus: { from: entry.order.paymentStatus, to: summary.proposedPaymentStatus },
      orderStatus: { from: entry.order.orderStatus, to: summary.proposedOrderStatus },
      ...(retainedMutation ? {
        providerMetadata: {
          externalTransactionID: external,
          paylinkID: paylink,
          saleID: provider.saleID || null,
          transactionID: provider.receiptNumber || provider.transactionID || null,
          amount,
          currency,
          paidAt,
          verificationSource: "reviewed-production-reconciliation",
          reconciliationAuditReference: incidentID || null,
        },
        authoritativePaymentEvent: { idempotencyKey: provider.receiptNumber || provider.transactionID || provider.saleID || external, status: "Paid", source: "reviewed-production-reconciliation" },
      } : {
        duplicateOf: retained?.orderNumber || null,
        providerStatusAtReconciliation: providerStatuses.get(normal(entry.order.orderNumber)) || null,
        reconciliationAuditReference: incidentID || null,
      }),
    },
    evidence: retainedMutation
      ? [`authoritative ${authoritativeReason} match`, "provider amount match", "provider currency match", "provider paid status required by reviewed input"]
      : [...entry.reasons, `provider status ${providerStatuses.get(normal(entry.order.orderNumber)) || "missing"}`],
    safeguards: retainedMutation
      ? ["must not create a new order", "must not send customer email", "must not run fulfilment", "must use conditional Blob write"]
      : ["preserve duplicate record", "do not reverse stock without recorded movement", "do not send customer email", "do not run fulfilment", "must use conditional Blob write"],
    rollback: {
      procedure: "Restore this order's exact pre-change payment and order statuses from the checksummed snapshot using a reviewed conditional write; append a compensating audit entry and never overwrite newer provider evidence.",
      paymentStatus: entry.order.paymentStatus,
      orderStatus: entry.order.orderStatus,
      originalRecordSHA256: createHash("sha256").update(JSON.stringify(entry.order)).digest("hex"),
      compensatingAuditAction: "rollback-reviewed-reconciliation",
    },
    auditEntry: {
      action: retainedMutation ? "reconcile-authoritative-provider-payment" : "classify-duplicate-order",
      orderNumber: entry.order.orderNumber,
      retainedOrder: retained?.orderNumber || null,
      sourceTransaction: external || paylink,
      saleID: provider.saleID || null,
      receiptNumber: provider.receiptNumber || provider.transactionID || null,
      before: { paymentStatus: entry.order.paymentStatus, orderStatus: entry.order.orderStatus },
      after: { paymentStatus: summary.proposedPaymentStatus, orderStatus: summary.proposedOrderStatus },
      evidence: retainedMutation ? "authoritative provider identifiers and approved invoice" : "secondary duplicate grouping plus provider-unpaid status",
    },
  };
};
const proposedMutations = classifiedOrders.filter((entry) => entry.classification !== "unrelated-order").map(mutationFor);
const result = {
  mode: args.has("--apply") ? "apply" : args.has("--dry-run") ? "dry-run" : "report",
  incidentID: incidentID || null,
  evidence: { externalTransactionID: external || null, paylinkID: paylink || null, saleID: provider.saleID || null, receiptNumber: provider.receiptNumber || provider.transactionID || null, invoiceItemReference: invoiceItemReference || null, providerStatus: provider.status || provider.paymentStatus || null, providerLookupStatus: provider.lookupStatus || provider.providerLookupStatus || null, amount, currency, timestamp: paidAt || null, authoritativeMatch: authoritativeReason, payerEvidence: providerCustomerHash ? "masked-customer-hash" : independentPayerSubstitute ? "independent-provider-invoice-and-lookup-chain" : "missing", duplicateWindowHours: windowHours },
  retainedOrder: retained ? orderSummary(classifiedOrders.find((entry) => entry.order === retained)) : null,
  duplicateOrders: duplicates.map(orderSummary),
  unrelatedOrders: unrelated.map(orderSummary),
  stockEffects: { retained: retained?.stockMovements || [], duplicates: duplicates.map(({ order }) => ({ orderNumber: order.orderNumber, movements: order.stockMovements || [], proposedReversal: order.stockMovements || [] })) },
  sideEffects: { emails: clusterOrders.map((order) => ({ orderNumber: order.orderNumber, sent: order.confirmationEmailSent ?? null, determination: sideEffectEvidence.get(normal(order.orderNumber))?.emailEffect || null })), fulfilment: clusterOrders.map((order) => ({ orderNumber: order.orderNumber, state: order.fulfilmentState ?? null, determination: sideEffectEvidence.get(normal(order.orderNumber))?.fulfilmentEffect || null })) },
  proposedMutations,
  conditionalWrite: { store: "lullubelle-admin", key: "orders", expectedETag: ordersBlobETag || null, conflictAction: "abort without mutation and regenerate evidence from a fresh snapshot" },
  evidenceGate: { passed: blockers.length === 0, dryRunAllowed: blockers.length === 0, applyAllowed: blockers.length === 0 && args.has("--apply") && args.has("--confirm-apply") },
  blockers,
  audit: { actor: process.env.RECONCILIATION_ACTOR || "operator-review-required", reason: "iKhokha payment reconciliation", sourceTransaction: external || paylink, retainedOrder: retained?.orderNumber || null, duplicateOrders: duplicates.map(({ order }) => order.orderNumber), evidence: { authoritativeReason, amountMatched: Boolean(retained), currencyMatched: Boolean(retained), maskedCustomerHashMatched: Boolean(providerCustomerHash && providerCustomerHash === retainedCustomerHash), payerEvidenceSubstitutedByIndependentProviderChain: independentPayerSubstitute, saleID: provider.saleID || null, receiptNumber: provider.receiptNumber || provider.transactionID || null, invoiceItemReference: invoiceItemReference || null } },
};

const applyReviewedReconciliation = async () => {
  if (!args.has("--confirm-apply") || blockers.length) throw new Error("Apply is gated: require --confirm-apply and zero reconciliation blockers.");
  const confirmedIncidentID = String(valueAfter("--incident-id") || "").trim();
  if (!incidentID || confirmedIncidentID !== incidentID) throw new Error("Apply is gated: --incident-id must exactly match the reviewed evidence incidentID.");
  const allowlist = String(valueAfter("--allow-orders") || "").split(",").map((value) => value.trim()).filter(Boolean);
  const proposedOrderNumbers = proposedMutations.map((mutation) => mutation.orderNumber);
  if (!allowlist.length || allowlist.length !== proposedOrderNumbers.length || new Set(allowlist).size !== allowlist.length || allowlist.some((orderNumber) => !proposedOrderNumbers.includes(orderNumber)) || proposedOrderNumbers.some((orderNumber) => !allowlist.includes(orderNumber))) {
    throw new Error("Apply is gated: --allow-orders must exactly equal the reviewed mutation set.");
  }
  if (proposedMutations.some((mutation) => !mutation.rollback?.procedure || !mutation.rollback?.originalRecordSHA256 || !mutation.auditEntry?.before || !mutation.auditEntry?.after || !mutation.evidence?.length)) throw new Error("Apply is gated: every mutation requires evidence, audit, and explicit compensating rollback data.");
  const siteID = String(input.snapshot?.siteID || "").trim();
  if (!siteID || !ordersBlobETag) throw new Error("Apply is gated: snapshot site ID and orders Blob ETag are required.");
  let token = String(process.env.NETLIFY_AUTH_TOKEN || "").trim();
  if (!token) {
    const config = JSON.parse(await readFile(join(homedir(), "Library/Preferences/netlify/config.json"), "utf8"));
    token = String(Object.values(config.users || {})[0]?.auth?.token || "").trim();
  }
  if (!token) throw new Error("Apply is gated: authenticated Netlify access is unavailable.");
  const store = getStore({ name: "lullubelle-admin", siteID, token });
  const current = await store.getWithMetadata("orders", { type: "json", consistency: "strong" });
  if (!current?.etag || current.etag !== ordersBlobETag) throw new Error("Apply aborted: production orders ETag differs from the reviewed snapshot. No retry was attempted.");
  if (!Array.isArray(current.data) || JSON.stringify(current.data) !== JSON.stringify(orders)) throw new Error("Apply aborted: production order records differ from the reviewed snapshot despite the supplied ETag.");
  if (current.data.length !== expectedOrderCount) throw new Error("Apply aborted: production order count differs from the reviewed snapshot.");

  const getEnvironment = async () => {
    const headers = { Authorization: `Bearer ${token}` };
    const siteResponse = await fetch(`https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteID)}`, { headers });
    if (!siteResponse.ok) throw new Error("Apply aborted: unable to verify the linked production site.");
    const site = await siteResponse.json();
    const envResponse = await fetch(`https://api.netlify.com/api/v1/accounts/${encodeURIComponent(site.account_id)}/env?site_id=${encodeURIComponent(siteID)}`, { headers });
    if (!envResponse.ok) throw new Error("Apply aborted: unable to load provider configuration for fresh status verification.");
    const values = await envResponse.json();
    const value = (key) => values.find((entry) => entry.key === key)?.values?.find((entry) => entry.context === "production")?.value
      ?? values.find((entry) => entry.key === key)?.values?.find((entry) => entry.context === "all")?.value;
    return { appID: value("IKHOKHA_API_KEY"), secret: value("IKHOKHA_API_SECRET"), baseURL: String(value("IKHOKHA_API_BASE_URL") || "https://api.ikhokha.com").replace(/\/$/, "") };
  };
  const providerConfig = await getEnvironment();
  if (!providerConfig.appID || !providerConfig.secret) throw new Error("Apply aborted: provider credentials are unavailable for fresh status verification.");
  const escapeSignature = (value) => String(value).replace(/[\\"']/g, "\\$&").replace(/\u0000/g, "\\0");
  for (const order of clusterOrders) {
    const statusPath = `/public-api/v1/api/getStatus/${encodeURIComponent(order.ikhokhaPaylinkId || order.paylinkID || "")}`;
    if (statusPath.endsWith("/")) throw new Error("Apply aborted: a cluster order has no PayLink ID for fresh provider verification.");
    const signature = createHmac("sha256", String(providerConfig.secret).trim()).update(escapeSignature(statusPath)).digest("hex");
    const response = await fetch(`${providerConfig.baseURL}${statusPath}`, { headers: { Accept: "application/json", "IK-APPID": providerConfig.appID, "IK-SIGN": signature } });
    if (!response.ok) throw new Error("Apply aborted: fresh provider status verification failed.");
    const body = await response.json();
    const actualStatus = normal(body.status || body.paymentStatus || body.transactionStatus || body.data?.status);
    const expectedStatus = providerStatuses.get(normal(order.orderNumber));
    if (actualStatus !== expectedStatus) throw new Error("Apply aborted: provider state changed after the reviewed evidence snapshot.");
    const actualPaylink = String(body.paylinkID || body.paymentLinkID || body.data?.paylinkID || "").trim();
    if (actualPaylink && actualPaylink !== String(order.ikhokhaPaylinkId || order.paylinkID || "")) throw new Error("Apply aborted: provider PayLink identity changed after the reviewed evidence snapshot.");
    const actualAmount = Number(body.amount ?? body.data?.amount);
    if (Number.isFinite(actualAmount) && Math.abs(actualAmount - amount) > 0.01 && Math.abs(actualAmount - amount * 100) > 1) throw new Error("Apply aborted: provider amount changed after the reviewed evidence snapshot.");
  }
  const appliedAt = new Date().toISOString();
  const mutationMap = new Map(proposedMutations.map((mutation) => [mutation.orderNumber, mutation]));
  const receiptNumber = String(provider.receiptNumber || provider.transactionID || "").trim();
  const paymentEventKey = receiptNumber || String(provider.saleID || external);
  const nextOrders = current.data.map((order) => {
    const mutation = mutationMap.get(order.orderNumber);
    if (!mutation) return order;
    const auditEntry = { ...mutation.auditEntry, incidentID, appliedAt };
    const reconciliationAudit = [...(Array.isArray(order.reconciliationAudit) ? order.reconciliationAudit : []), auditEntry];
    if (mutation.classification === "authoritative-retained-order") {
      const existingEvents = Array.isArray(order.paymentEvents) ? order.paymentEvents : [];
      const matchingEvents = existingEvents.filter((event) => String(event.idempotencyKey || event.transactionID || "") === paymentEventKey);
      if (matchingEvents.length > 1) throw new Error("Apply aborted: more than one authoritative payment event already exists.");
      const paymentEvents = matchingEvents.length === 1 ? existingEvents : [...existingEvents, {
        idempotencyKey: paymentEventKey,
        type: "payment_reconciled",
        status: "Paid",
        provider: "iKhokha",
        externalTransactionID: external,
        paylinkID: paylink,
        saleID: provider.saleID || null,
        transactionID: receiptNumber || null,
        amount,
        currency,
        paidAt,
        source: "reviewed-production-reconciliation",
        reconciliationAuditReference: incidentID,
        recordedAt: appliedAt,
      }];
      return {
        ...order,
        paymentStatus: "Paid",
        orderStatus: "Processing",
        externalTransactionID: external,
        ikhokhaPaylinkId: paylink,
        ikhokhaSaleId: provider.saleID || null,
        transactionID: receiptNumber || null,
        paymentAmount: amount,
        currency,
        paidAt,
        verificationSource: "reviewed-production-reconciliation",
        reconciliationAuditReference: incidentID,
        reconciliationAuditSummary: { ...result.audit, incidentID, appliedAt },
        reconciliationAudit,
        paymentEvents,
      };
    }
    return {
      ...order,
      paymentStatus: "Duplicate/Cancelled",
      orderStatus: "Duplicate/Cancelled",
      duplicateOf: retained.orderNumber,
      providerStatusAtReconciliation: "UNPAID",
      reconciliationAuditReference: incidentID,
      reconciliationAudit,
    };
  });
  if (nextOrders.length !== current.data.length || nextOrders.filter((order, index) => JSON.stringify(order) !== JSON.stringify(current.data[index])).length !== proposedMutations.length) throw new Error("Apply aborted: generated mutation count differs from the reviewed allowlist.");
  const writeResult = await store.setJSON("orders", nextOrders, { onlyIfMatch: ordersBlobETag });
  if (!writeResult?.modified || !writeResult.etag) throw new Error("Apply aborted: conditional Blob write was rejected. No retry was attempted.");
  return { applied: true, incidentID, changedOrderCount: proposedMutations.length, previousETag: ordersBlobETag, newETag: writeResult.etag, appliedAt };
};
let applyResult = null;
if (args.has("--apply")) applyResult = await applyReviewedReconciliation();
if (applyResult) result.applyResult = applyResult;
const maskIdentifier = (value) => {
  const text = String(value || "");
  if (!text) return null;
  return text.length <= 8 ? "[redacted]" : `${text.slice(0, 4)}…${text.slice(-4)}`;
};
const sensitiveIdentifierKeys = /^(id|orderNumber|retainedOrder|duplicateOf|externalTransactionID|paylinkID|saleID|receiptNumber|transactionID|sourceTransaction|idempotencyKey)$/i;
const redactReport = (value, key = "") => {
  if (key === "incidentID") return value ? `incident-${createHash("sha256").update(String(value)).digest("hex").slice(0, 12)}` : null;
  if (sensitiveIdentifierKeys.test(key) && (value === null || typeof value !== "object")) return maskIdentifier(value);
  if (Array.isArray(value)) return value.map((entry) => redactReport(entry, key === "duplicateOrders" && typeof entry === "string" ? "orderNumber" : ""));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactReport(childValue, childKey)]));
  return value;
};
const reportResult = redactReport(result);
if (args.has("--report")) await writeFile(valueAfter("--report"), JSON.stringify(reportResult, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify(reportResult, null, 2));
if (blockers.length) process.exitCode = 2;
