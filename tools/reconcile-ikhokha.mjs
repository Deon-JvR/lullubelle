#!/usr/bin/env node
/*
 * Controlled operator tool. It never talks to production unless --apply is
 * explicitly supplied. Input is a read-only export containing provider,
 * orders, attempts, callbackLogs, and blobAudit arrays.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const args = new Set(process.argv.slice(2));
const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : "";
};
const inputPath = valueAfter("--input");
if (!inputPath) throw new Error("Usage: node tools/reconcile-ikhokha.mjs --input export.json [--report out.json] [--dry-run] [--apply --confirm-apply]");
const input = JSON.parse(await readFile(inputPath, "utf8"));
const provider = input.provider || {};
const external = String(provider.externalTransactionID || "").trim();
const paylink = String(provider.paylinkID || "").trim();
const amount = Number(provider.amount);
const currency = String(provider.currency || "").toUpperCase();
assert(external, "provider.externalTransactionID is required");
assert(paylink || provider.paylinkID === undefined, "provider.paylinkID must be a string when supplied");
assert(Number.isFinite(amount), "provider.amount is required");
assert(currency, "provider.currency is required");

const orders = Array.isArray(input.orders) ? input.orders : [];
const normal = (v) => String(v || "").trim().toLowerCase();
const byExternal = orders.filter((o) => normal(o.externalTransactionID) === normal(external));
const byPaylink = paylink ? orders.filter((o) => String(o.ikhokhaPaylinkId || "") === paylink) : [];
const candidates = byExternal.length ? byExternal : byPaylink;
const amountMatches = (o) => Math.abs(Number(o.total) - amount) <= 0.01 || Math.abs(Number(o.total) * 100 - amount) <= 1;
const exact = candidates.filter((o) => amountMatches(o) && String(o.currency || "ZAR").toUpperCase() === currency);
const retained = exact.slice().sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))[0] || null;
const duplicates = exact.filter((o) => o !== retained);
const blockers = [];
if (!retained) blockers.push("No order matches externalTransactionID/paylinkID, amount and currency.");
if (exact.length > 1 && exact.some((o) => o.customer?.email && retained?.customer?.email && normal(o.customer.email) !== normal(retained.customer.email))) blockers.push("Matching orders have different customer emails.");
if (input.provider.responseCode && String(input.provider.responseCode) !== "00") blockers.push("iKhokha responseCode is not 00.");

const result = {
  mode: args.has("--apply") ? "apply" : args.has("--dry-run") ? "dry-run" : "report",
  evidence: { externalTransactionID: external, paylinkID: paylink || null, amount, currency, timestamp: provider.timestamp || null },
  retainedOrder: retained ? { orderNumber: retained.orderNumber, id: retained.id, currentPaymentStatus: retained.paymentStatus, proposedPaymentStatus: "Paid" } : null,
  duplicateOrders: duplicates.map((o) => ({ orderNumber: o.orderNumber, id: o.id, currentPaymentStatus: o.paymentStatus, proposedPaymentStatus: "Duplicate/Cancelled", auditReference: retained?.orderNumber || null })),
  stockEffects: { retained: retained?.stockMovements || [], duplicates: duplicates.map((o) => ({ orderNumber: o.orderNumber, movements: o.stockMovements || [], proposedReversal: o.stockMovements || [] })) },
  sideEffects: { emails: orders.map((o) => ({ orderNumber: o.orderNumber, sent: o.confirmationEmailSent || false })), fulfilment: orders.map((o) => ({ orderNumber: o.orderNumber, state: o.fulfilmentState || null })) },
  blockers,
  audit: { actor: process.env.RECONCILIATION_ACTOR || "operator-review-required", reason: "iKhokha payment reconciliation", sourceTransaction: external, retainedOrder: retained?.orderNumber || null, duplicateOrders: duplicates.map((o) => o.orderNumber) },
};

if (args.has("--apply") && (!args.has("--confirm-apply") || blockers.length)) throw new Error("Apply is gated: require --confirm-apply and zero reconciliation blockers. This tool does not mutate production exports.");
if (args.has("--report")) await writeFile(valueAfter("--report"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
if (blockers.length) process.exitCode = 2;
