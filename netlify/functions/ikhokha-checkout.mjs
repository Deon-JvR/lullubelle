import {
  ORDERS_KEY,
  connectBlobContext,
  createRecord,
  json,
  mutateList,
  newId,
  parseJson,
  readContent,
  readList,
  readRecord,
  updateRecord,
  writeList,
} from "./_admin-shared.mjs";
import { calculateDiscount, releaseRedemption, reserveRedemption, validatePromo } from "./_discounts.mjs";
import { DOOR_TO_DOOR_FEE, DOOR_TO_DOOR_METHOD, calculateDelivery, normaliseDeliveryMethod, sanitiseDeliverySettings } from "./_delivery.mjs";
import { apiSecurityHeaders, mergeSecurityHeaders } from "./lib/security-headers.mjs";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const toBoolean = (value) => /^(1|true|yes|on)$/i.test(String(value || ""));

const logConfigurationStatus = () => {
  console.info("iKhokha configuration", {
    IKHOKHA_API_KEY: process.env.IKHOKHA_API_KEY ? "present" : "missing",
    IKHOKHA_API_SECRET: process.env.IKHOKHA_API_SECRET ? "present" : "missing",
    IKHOKHA_API_BASE_URL: process.env.IKHOKHA_API_BASE_URL ? "present" : "missing",
  });
};
logConfigurationStatus();

const siteUrl = (event) => {
  const configured = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (configured) return configured.replace(/\/$/, "");
  const host = event.headers.host || event.headers.Host || "localhost:8888";
  const proto = host.includes("localhost") ? "http" : "https";
  return `${proto}://${host}`;
};

const ikhokhaBaseUrl = () => {
  if (process.env.IKHOKHA_API_BASE_URL) return process.env.IKHOKHA_API_BASE_URL.replace(/\/$/, "");
  return "https://api.ikhokha.com";
};

const checkoutEndpoint = () => {
  return "/public-api/v1/api/payment";
};

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

export const mapIkhokhaStatus = (value) => {
  const status = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (["successful", "success", "paid", "completed", "approved", "paymentlink_paid"].includes(status)) return "Paid";
  if (["pending", "processing", "paymentlink_created"].includes(status)) return "Pending";
  if (["failed", "failure", "declined", "rejected", "paymentlink_failed"].includes(status)) return "Failed";
  if (["cancelled", "canceled", "expired"].includes(status)) return "Cancelled";
  if (["refunded"].includes(status)) return "Refunded";
  if (["partially_refunded", "partial_refund"].includes(status)) return "Partially Refunded";
  return "Unknown";
};

const objectValue = (value, names) => {
  if (!value || typeof value !== "object") return undefined;
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const [key, child] of Object.entries(value)) {
    if (wanted.has(key.toLowerCase()) && child !== undefined && child !== null && child !== "") return child;
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      const found = objectValue(child, names);
      if (found !== undefined) return found;
    }
  }
  return undefined;
};

export const extractResponseCode = (payload = {}) => String(objectValue(payload, ["responseCode", "response_code", "responsecode"]) ?? "").trim();

const normaliseReference = (value) => String(value ?? "").trim().toLowerCase();
export const extractPaymentReference = (payload = {}) => {
  return objectValue(payload, ["externalTransactionID", "externalTransactionId", "external_transaction_id", "merchantReference", "orderNumber", "orderId", "paymentReference", "reference"]) || "";
};
export const extractPaymentStatus = (payload = {}) => {
  if (extractResponseCode(payload) === "00") return "Paid";
  return mapIkhokhaStatus(objectValue(payload, ["status", "paymentStatus", "transactionStatus", "result", "event"]));
};
export const amountsMatch = (expected, received) => {
  if (received === undefined || received === null || received === "") return false;
  const value = Number(received);
  if (!Number.isFinite(value)) return false;
  const receivedAmount = Math.abs(value) >= 100 ? value / 100 : value;
  return Math.abs(money(expected) - money(receivedAmount)) <= 0.01;
};

const safeProviderBody = (data) => {
  if (!data || typeof data !== "object") return data;
  const blocked = new Set(["authorization", "Authorization", "token", "secret", "apiKey", "apiSecret", "password"]);
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [
    key,
    blocked.has(key) ? "[masked]" : value,
  ]));
};
const providerShape = (value) => value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, child && typeof child === "object" && !Array.isArray(child) ? providerShape(child) : Array.isArray(child) ? `[array:${child.length}]` : typeof child]))
  : typeof value;

const maskedIkhokhaHeaders = () => ({
  Accept: "application/json",
  "Content-Type": "application/json",
  "IK-APPID": process.env.IKHOKHA_API_KEY ? "[masked Application Key ID]" : "",
  "IK-SIGN": "[generated HMAC signature]",
});

const maskedAuthDiagnostic = () => ({
  authMethod: "IK-APPID + IK-SIGN",
  applicationKeyIdPresent: Boolean(process.env.IKHOKHA_API_KEY),
  applicationKeySecretPresent: Boolean(process.env.IKHOKHA_API_SECRET),
  applicationKeyIdLength: String(process.env.IKHOKHA_API_KEY || "").length,
  applicationKeySecretLength: String(process.env.IKHOKHA_API_SECRET || "").length,
  trimmedApplicationKeyIdLength: String(process.env.IKHOKHA_API_KEY || "").trim().length,
  trimmedApplicationKeySecretLength: String(process.env.IKHOKHA_API_SECRET || "").trim().length,
});

const responseHeadersObject = (headers) => Object.fromEntries(headers.entries());

const providerErrorMessage = (data, fallback) => {
  const base = data?.message || data?.error || fallback;
  const validation = data?.validationErrors || data?.errors || data?.details;
  if (!validation) return base;
  if (Array.isArray(validation)) {
    const detail = validation
      .map((item) => {
        if (typeof item === "string") return item;
        const field = item.field || item.path || item.property || item.name || "request";
        const message = item.message || item.error || item.reason || JSON.stringify(item);
        return `${field}: ${message}`;
      })
      .join("; ");
    return detail ? `${base}: ${detail}` : base;
  }
  if (typeof validation === "object") return `${base}: ${JSON.stringify(validation)}`;
  return `${base}: ${String(validation)}`;
};

export const escapeIkhokhaSignatureString = (value) => String(value)
  .replace(/[\\"']/g, "\\$&")
  .replace(/\u0000/g, "\\0");

export const ikhokhaRequestParts = ({ requestUrl, serializedBody = "", method = "GET", timestamp = "" }) => {
  const url = new URL(String(requestUrl), "https://api.ikhokha.com");
  return {
    requestUrl: url.toString(),
    pathname: url.pathname || "/",
    query: url.search,
    serializedBody: String(serializedBody),
    method: String(method || "GET").toUpperCase(),
    timestamp: String(timestamp || ""),
  };
};

export const createIkhokhaSignature = ({ requestUrl, serializedBody = "", secret, escapePayload = true, method = "GET", timestamp = "" }) => {
  const parts = ikhokhaRequestParts({ requestUrl, serializedBody, method, timestamp });
  // iKhokha signs pathname + exact body. Query parameters remain on the
  // outgoing request URL but are explicitly excluded from the signature base.
  const signingPayload = parts.pathname + parts.serializedBody;
  return createHmac("sha256", String(secret || "").trim())
    .update(escapePayload ? escapeIkhokhaSignatureString(signingPayload) : signingPayload, "utf8")
    .digest("hex");
};

export const createIkhokhaSignedRequest = ({ requestUrl, serializedBody = "", secret, escapePayload = true, method = "GET", timestamp = "" }) => {
  const parts = ikhokhaRequestParts({ requestUrl, serializedBody, method, timestamp });
  return {
    ...parts,
    signingBase: escapePayload ? escapeIkhokhaSignatureString(parts.pathname + parts.serializedBody) : parts.pathname + parts.serializedBody,
    signature: createIkhokhaSignature({ ...parts, secret, escapePayload }),
  };
};

export const generateIkhokhaSignature = ({ path, requestBody, requestBodyString, secret }) => {
  const bodyString = requestBodyString ?? JSON.stringify(requestBody);
  return createIkhokhaSignature({ requestUrl: `https://api.ikhokha.com${path}`, serializedBody: bodyString, secret });
};

export const buildIkhokhaPayload = ({ base, order }) => {
  const amountInCents = Math.round(money(order.total) * 100);
  const encodedOrder = encodeURIComponent(order.orderNumber);
  return {
    amount: amountInCents,
    currency: "ZAR",
    externalTransactionID: order.orderNumber,
    description: `Lullubelle order ${order.orderNumber}`,
    entityID: String(process.env.IKHOKHA_API_KEY || "").trim(),
    mode: toBoolean(process.env.IKHOKHA_TEST_MODE) ? "test" : "live",
    requesterUrl: base,
    urls: {
      callbackUrl: `${base}/.netlify/functions/ikhokha-checkout?action=confirm&order=${encodedOrder}`,
      successPageUrl: `${base}/payment-success?order=${encodedOrder}`,
      failurePageUrl: `${base}/payment-cancelled?order=${encodedOrder}`,
      cancelUrl: `${base}/payment-cancelled?order=${encodedOrder}`,
    },
  };
};

const logIkhokhaDiagnostic = (level, message, diagnostic) => {
  const rendered = JSON.stringify(diagnostic, null, 2);
  if (level === "error") console.error(`${message}\n${rendered}`);
  else console.info(`${message}\n${rendered}`);
};

const orderNumber = () => `LUL-${Date.now()}`;
const PAYMENT_ATTEMPT_TTL_MS = 30 * 60 * 1000;
// Checkout writes are protected by onlyIfNew/onlyIfMatch. Normal Blob reads
// are therefore safe: a stale ETag fails closed instead of overwriting data,
// and works in Functions runtimes that do not expose uncachedEdgeURL.
export const CHECKOUT_BLOB_READ_OPTIONS = Object.freeze({ strong: false });
const mutateOrders = (mutator) => mutateList(ORDERS_KEY, mutator, CHECKOUT_BLOB_READ_OPTIONS);
const readPaymentAttempt = (key) => readRecord(key, CHECKOUT_BLOB_READ_OPTIONS);
const terminalPaymentStatus = (order) => ["paid", "refunded", "partially refunded"].includes(String(order?.paymentStatus || "").toLowerCase())
  || ["fulfilling", "shipped", "completed"].includes(String(order?.orderStatus || "").toLowerCase());
const attemptKey = (id) => `ikhokha-attempts/${String(id).replace(/[^a-z0-9_-]/gi, "").slice(0, 128)}`;
const checkoutFingerprint = ({ customer, products, total, delivery }) => createHash("sha256").update(JSON.stringify({
  email: String(customer.email || "").trim().toLowerCase(),
  phone: String(customer.phone || "").replace(/\D/g, ""),
  products: products.map(({ id, quantity }) => [id, quantity]).sort(),
  total: money(total),
  delivery: delivery.option,
})).digest("hex");

const parseCallbackBody = (event) => {
  const contentType = String(event.headers["content-type"] || event.headers["Content-Type"] || "").toLowerCase();
  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : String(event.body || "");
  if (contentType.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
};

const PROVIDER_URL_FIELD_NAMES = [
  "paymentUrl",
  "paymentURL",
  "paymentPageUrl",
  "paymentPageURL",
  "paymentLinkUrl",
  "paymentLinkURL",
  "paymentLink",
  "paylinkUrl",
  "payLinkUrl",
  "payLinkURL",
  "checkoutUrl",
  "checkoutURL",
  "checkoutLink",
  "redirectUrl",
  "redirectURL",
  "url",
  "href",
  "link",
];

const REQUEST_URL_FIELD_NAMES = new Set([
  "requesterUrl",
  "callbackUrl",
  "successPageUrl",
  "failurePageUrl",
  "cancelUrl",
  "successUrl",
  "failureUrl",
]);

const isHostedPaymentUrlCandidate = ({ key, path, value }) => {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return false;
  if (REQUEST_URL_FIELD_NAMES.has(key)) return false;
  if (path.some((segment) => REQUEST_URL_FIELD_NAMES.has(segment))) return false;
  return PROVIDER_URL_FIELD_NAMES.includes(key) || /payment|pay|checkout|redirect|link|url/i.test(key);
};

const collectHostedPaymentUrlCandidates = (payload, path = []) => {
  if (!payload || typeof payload !== "object") return [];
  return Object.entries(payload).flatMap(([key, value]) => {
    const nextPath = [...path, key];
    const direct = isHostedPaymentUrlCandidate({ key, path: nextPath, value })
      ? [{ path: nextPath.join("."), value }]
      : [];
    const nested = value && typeof value === "object"
      ? collectHostedPaymentUrlCandidates(value, nextPath)
      : [];
    return [...direct, ...nested];
  });
};

export const extractPaymentUrl = (payload) => {
  const candidates = collectHostedPaymentUrlCandidates(payload);
  const preferred = candidates.find((candidate) => /payment|pay|checkout/i.test(candidate.path));
  return preferred?.value || candidates[0]?.value || "";
};
export const extractPaylinkId = (payload = {}) => {
  return String(objectValue(payload, ["paylinkID", "paylinkId", "paylink_id"]) || "").trim();
};

const buildCatalog = async () => {
  const content = await readContent();
  const productEntries = (content.products || []).map((product) => [
    product.id,
    {
      id: product.id,
      name: `${product.brand ? `${product.brand} ` : ""}${product.name}`.trim(),
      price: Number(product.price) || 0,
      image: product.image || "lullubelle-logo.jpg",
      brandId: product.brandId || "",
      categories: Array.isArray(product.categories) ? product.categories : [],
    },
  ]);
  const voucherEntries = (content.vouchers || []).map((voucher) => [
    voucher.id,
    {
      id: voucher.id,
      name: `Lullubelle Gift Voucher ${voucher.name || `R${voucher.amount}`}`,
      price: Number(voucher.amount) || 0,
      image: "lullubelle-logo.jpg",
    },
  ]);
  return new Map([...productEntries, ...voucherEntries]);
};

const normaliseItems = async (items) => {
  if (!Array.isArray(items) || !items.length) {
    throw new Error("Your cart is empty.");
  }

  const catalog = await buildCatalog();
  return items.map((item) => {
    const quantity = Math.max(1, Math.min(99, Number.parseInt(item.quantity, 10) || 1));
    const catalogItem = catalog.get(item.id);
    if (catalogItem) {
      return { ...catalogItem, quantity };
    }

    if (String(item.id || "").startsWith("online-skin-consultation")) {
      return {
        id: String(item.id),
        name: "Online skin consultation with Luzelle - 30 minutes",
        price: 800,
        image: "owner-luzelle.jpg",
        quantity,
      };
    }

    throw new Error(`Product is no longer available: ${item.name || item.id}`);
  });
};

const createPendingOrder = async ({ customer, delivery, address, notes, products, subtotal, originalSubtotal, discount, deliveryFee, deliveryCalculation, total, paymentReference, reservationId, paymentAttemptId, fingerprint }) => {
  const order = {
    id: newId("order"),
    orderNumber: paymentReference,
    externalTransactionID: paymentReference,
    paymentAttemptId,
    checkoutFingerprint: fingerprint,
    createdAt: new Date().toISOString(),
    customer,
    delivery,
    deliveryMethod: delivery.option,
    address,
    notes,
    products,
    subtotal,
    originalSubtotal,
    promoCode: discount?.discount?.code || "",
    discountType: discount?.discount?.type || "",
    discountAmount: discount?.discountAmount || 0,
    discountSnapshot: discount?.discount ? { ...discount.discount } : null,
    deliveryFee,
    freeDeliveryApplied: deliveryCalculation.freeDeliveryApplied,
    deliverySettingsSnapshot: {
      freeDeliveryThreshold: deliveryCalculation.freeDeliveryThreshold,
      standardPudoFee: deliveryCalculation.standardPudoFee,
      collectionEnabled: deliveryCalculation.collectionEnabled,
    },
    total,
    discountReservationId: reservationId || "",
    paymentProvider: "iKhokha iK Pay",
    paymentStatus: "Pending",
    orderStatus: "New",
  };
  await mutateOrders((orders) => [order, ...orders.filter((item) => item.orderNumber !== order.orderNumber)].slice(0, 500));
  return order;
};

const persistPaylinkOrder = async (pendingOrder, paylinkId, paymentUrl = "") => {
  await mutateOrders((latestOrders) => {
    const index = latestOrders.findIndex((item) => item.orderNumber === pendingOrder.orderNumber);
    const enriched = index >= 0 ? { ...latestOrders[index], ikhokhaPaylinkId: paylinkId, paymentUrl } : { ...pendingOrder, ikhokhaPaylinkId: paylinkId, paymentUrl };
    return index >= 0 ? latestOrders.map((item, itemIndex) => itemIndex === index ? enriched : item) : [enriched, ...latestOrders].slice(0, 500);
  });
  const delays = [0, 100, 250, 500, 1000];
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]) await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    const verified = (await readList(ORDERS_KEY)).find((item) => item.orderNumber === pendingOrder.orderNumber);
    const found = Boolean(verified);
    const present = Boolean(verified?.ikhokhaPaylinkId);
    const matches = Boolean(present && verified.ikhokhaPaylinkId === paylinkId);
    if (matches) { console.info(`iKhokha paylink persistence ${JSON.stringify({ orderNumber: pendingOrder.orderNumber, status: "verified", attempt: attempt + 1 })}`); return verified; }
  }
  console.error(`iKhokha paylink persistence ${JSON.stringify({ orderNumber: pendingOrder.orderNumber, status: "failed" })}`);
  throw new Error("Unable to verify iKhokha paylink persistence.");
};

const callIkhokha = async ({ event, order, testMode }) => {
  const base = siteUrl(event);
  const payload = buildIkhokhaPayload({ base, order, testMode });

  const path = checkoutEndpoint();
  const requestUrl = `${ikhokhaBaseUrl()}${path}`;
  const requestBodyString = JSON.stringify(payload);
  const applicationKey = String(process.env.IKHOKHA_API_KEY || "").trim();
  const signature = createIkhokhaSignature({ requestUrl, serializedBody: requestBodyString, secret: process.env.IKHOKHA_API_SECRET });
  const requestLog = {
    requestPath: path,
    method: "POST",
    bodyLength: requestBodyString.length,
    signatureLength: signature.length,
    apiKeyPresent: Boolean(applicationKey),
    apiSecretPresent: Boolean(process.env.IKHOKHA_API_SECRET),
  };
  console.info(`iKhokha checkout started ${JSON.stringify({ requestPath: path, method: "POST", bodyLength: requestBodyString.length })}`);

  let response;
  try {
    response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "IK-APPID": applicationKey,
        "IK-SIGN": signature.trim(),
      },
      body: requestBodyString,
    });
  } catch (error) {
    const diagnostic = {
      step: "Function outbound request to iKhokha",
      ...requestLog,
      testMode,
      error: error.message || "Network request to iKhokha failed.",
    };
    logIkhokhaDiagnostic("error", "iKhokha network request failed.", diagnostic);
    const detail = new Error(`Unable to reach iKhokha API at ${requestUrl}: ${diagnostic.error}`);
    detail.diagnostic = diagnostic;
    throw detail;
  }

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  console.info(`iKhokha provider response ${JSON.stringify({ orderNumber: order.orderNumber, httpStatus: response.status })}`);

  let safeResponseHeaders;
  try {
    safeResponseHeaders = responseHeadersObject(response.headers);
  } catch (error) {
    throw error;
  }
  let safeProviderShape;
  try {
    safeProviderShape = providerShape(data);
  } catch (error) {
    throw error;
  }
  const responseLog = {
    step: "iKhokha checkout response received",
    ...requestLog,
    testMode,
    status: response.status,
    statusText: response.statusText,
    responseShape: safeProviderShape,
  };
  logIkhokhaDiagnostic(
    response.ok ? "info" : "error",
    response.ok ? "iKhokha checkout response received." : "iKhokha checkout request rejected.",
    responseLog,
  );

  if (!response.ok) {
    const diagnostic = {
      step: "iKhokha rejected checkout request",
      ...requestLog,
      testMode,
      status: response.status,
      statusText: response.statusText,
      responseShape: providerShape(data),
    };
    const message = providerErrorMessage(data, `iKhokha checkout failed with status ${response.status}.`);
    const detail = new Error(message);
    detail.diagnostic = diagnostic;
    throw detail;
  }
  const paymentUrl = extractPaymentUrl(data);
  if (!paymentUrl) {
    const diagnostic = {
      step: "iKhokha response missing payment URL",
      ...requestLog,
      testMode,
      status: response.status,
      statusText: response.statusText,
      responseShape: providerShape(data),
    };
    logIkhokhaDiagnostic("error", "iKhokha did not return a hosted payment URL.", diagnostic);
    const detail = new Error("iKhokha did not return a hosted payment URL.");
    detail.publicMessage = "iKhokha did not return a payment page. Please contact Lullubelle for help.";
    detail.diagnostic = diagnostic;
    throw detail;
  }

  return { paymentUrl, providerResponse: data };
};

const findPaymentOrderIndex = (orders, providerPayload, fallbackReference = "") => {
  const externalTransactionID = String(extractPaymentReference(providerPayload) || "").trim();
  const paylinkId = extractPaylinkId(providerPayload);
  if (externalTransactionID) {
    const index = orders.findIndex((order) => normaliseReference(order.externalTransactionID || order.orderNumber) === normaliseReference(externalTransactionID));
    if (index < 0) return -1;
    return index;
  }
  if (paylinkId) {
    const index = orders.findIndex((order) => String(order.ikhokhaPaylinkId || "") === paylinkId);
    return index;
  }
  const legacyReference = String(fallbackReference).trim();
  return legacyReference ? orders.findIndex((order) => !order.externalTransactionID && normaliseReference(order.orderNumber) === normaliseReference(legacyReference)) : -1;
};

const markOrderPaid = async (orderNumber, providerPayload) => {
  const data = providerPayload.data && typeof providerPayload.data === "object" ? providerPayload.data : providerPayload;
  const callbackPaylinkId = extractPaylinkId(providerPayload);
  const transactionId = String(objectValue(providerPayload, ["transactionID", "transactionId", "transaction_id"]) || callbackPaylinkId).trim();
  const providerAmount = objectValue(providerPayload, ["amount"]);
  const providerCurrency = objectValue(providerPayload, ["currency"]);
  const providerPaidAt = objectValue(providerPayload, ["paidAt", "paid_at"]);
  const now = new Date().toISOString();
  let updated = false;
  await mutateOrders((orders) => {
    const index = findPaymentOrderIndex(orders, providerPayload, orderNumber);
    if (index === -1) return orders;
    const order = orders[index];
    if (callbackPaylinkId && order.ikhokhaPaylinkId && callbackPaylinkId !== order.ikhokhaPaylinkId) return orders;
    updated = true;
    const eventKey = transactionId || normaliseReference(orderNumber);
    const history = Array.isArray(order.paymentEvents) ? order.paymentEvents : [];
    if (String(order.paymentStatus).toLowerCase() === "paid" || history.some((event) => event.idempotencyKey === eventKey)) return orders;
    orders[index] = { ...order,
    ikhokhaPaylinkId: order.ikhokhaPaylinkId || callbackPaylinkId || null,
    externalTransactionID: order.externalTransactionID || order.orderNumber,
    paymentStatus: "Paid",
    orderStatus: order.orderStatus === "New" ? "Processing" : order.orderStatus,
    paymentProvider: "iKhokha iK Pay",
    paymentReference: String(extractPaymentReference(providerPayload) || order.orderNumber),
    transactionId,
    paidAmount: money(Number(providerAmount) >= 100 ? Number(providerAmount) / 100 : providerAmount),
    currency: String(providerCurrency || "ZAR").toUpperCase(),
    paidAt: providerPaidAt || now,
    responseCode: extractResponseCode(providerPayload),
    paymentUpdatedAt: now,
    paymentVerifiedAt: now,
    verificationSource: data.reconciliation ? "reconciliation" : "webhook",
    providerConfirmation: safeProviderBody(providerPayload),
    reconciliationMetadata: { verifiedAt: now, source: data.reconciliation ? "server-reconciliation" : "ikhokha-callback", amountMatched: true, currencyMatched: true, paylinkMatched: !callbackPaylinkId || !order.ikhokhaPaylinkId || callbackPaylinkId === order.ikhokhaPaylinkId },
    paymentEvents: [...history, { timestamp: now, providerStatus: "paid", internalStatus: "Paid", transactionReference: transactionId || String(orderNumber), amount: money(Number(providerAmount) >= 100 ? Number(providerAmount) / 100 : providerAmount), verificationResult: "verified", eventSource: "ikhokha-webhook", idempotencyKey: eventKey }],
    };
    return orders;
  });
  if (updated) {
    const paidOrder = (await readList(ORDERS_KEY)).find((order) => normaliseReference(order.externalTransactionID || order.orderNumber) === normaliseReference(extractPaymentReference(providerPayload) || orderNumber));
    if (paidOrder?.paymentAttemptId && String(paidOrder.paymentStatus).toLowerCase() === "paid") {
      const recordKey = attemptKey(paidOrder.paymentAttemptId);
      const attempt = await readPaymentAttempt(recordKey);
      if (attempt.value && attempt.etag) await updateRecord(recordKey, { ...attempt.value, state: "paid", paidAt: paidOrder.paidAt, updatedAt: new Date().toISOString() }, attempt.etag);
    }
  }
  return updated;
};

const markOrderCancelled = async (orderNumber, providerPayload, internalStatus = "Cancelled") => {
  const orders = await readList(ORDERS_KEY);
  const index = orders.findIndex((order) => normaliseReference(order.orderNumber) === normaliseReference(orderNumber));
  if (index === -1) return false;

  if (terminalPaymentStatus(orders[index])) return true;
  await releaseRedemption(orders[index].discountReservationId);
  const now = new Date().toISOString();
  const data = providerPayload.data && typeof providerPayload.data === "object" ? providerPayload.data : providerPayload;
  const callbackPaylinkId = String(data.paylinkID || data.paylinkId || "").trim();
  const transactionId = String(data.transactionID || data.transactionId || data.transaction_id || data.paylinkID || "").trim();
  let updated = false;
  await mutateOrders((latest) => {
    const latestIndex = latest.findIndex((order) => normaliseReference(order.orderNumber) === normaliseReference(orderNumber));
    if (latestIndex < 0 || terminalPaymentStatus(latest[latestIndex])) { updated = latestIndex >= 0; return latest; }
    updated = true;
    const history = Array.isArray(latest[latestIndex].paymentEvents) ? latest[latestIndex].paymentEvents : [];
    const current = latest[latestIndex];
    const eventKey = transactionId || `${normaliseReference(orderNumber)}:${internalStatus}`;
    if (history.some((event) => event.idempotencyKey === eventKey)) return latest;
    latest[latestIndex] = {
    ...current,
    ikhokhaPaylinkId: current.ikhokhaPaylinkId || callbackPaylinkId || null,
    paymentStatus: internalStatus,
    orderStatus: internalStatus === "Cancelled" ? "Cancelled" : current.orderStatus,
    cancelledAt: internalStatus === "Cancelled" ? now : current.cancelledAt,
    paymentUpdatedAt: now,
    providerConfirmation: safeProviderBody(providerPayload),
    paymentEvents: [...history, { timestamp: now, providerStatus: internalStatus.toLowerCase(), internalStatus, transactionReference: transactionId || String(orderNumber), amount: money(Number(data.amount) >= 100 ? Number(data.amount) / 100 : data.amount), verificationResult: "verified", eventSource: "ikhokha-webhook", idempotencyKey: transactionId || `${normaliseReference(orderNumber)}:${internalStatus}` }],
    };
    return latest;
  });
  return updated;
};

const safeCompare = (left, right) => {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
};

// Keep the provider-specific string-to-sign isolated here. Replace only this
// function when iKhokha supplies its official webhook specification.
const callbackBodyForSigning = (event) => {
  const parsed = parseCallbackBody(event);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
  const canonical = { ...parsed };
  delete canonical.text;
  return JSON.stringify(canonical);
};

const callbackPathname = (event) => {
  const source = event.rawUrl || event.path || "/.netlify/functions/ikhokha-checkout";
  return new URL(String(source), "https://www.lullubelle.co.za").pathname;
};

export const callbackSignatureCandidates = ({ eventPath, canonicalBody = "", signatureSecret }) => {
  const secret = String(signatureSecret || "").trim();
  if (!canonicalBody || !secret) return [];
  return [createHmac("sha256", secret).update(escapeIkhokhaSignatureString(`${eventPath}${canonicalBody}`)).digest("hex")];
};

const headerValue = (headers = {}, names = []) => {
  const accepted = new Set(names.map((name) => name.toLowerCase()));
  return Object.entries(headers).find(([name]) => accepted.has(name.toLowerCase()))?.[1] || "";
};

export const verifyIkhokhaCallbackSignature = (event, { signatureSecret = process.env.IKHOKHA_API_SECRET, applicationId = process.env.IKHOKHA_API_KEY } = {}) => {
  const signature = headerValue(event.headers, ["x-ikhokha-signature", "x-ik-signature", "x-signature", "ik-sign", "ik-signature"]);
  const receivedAppId = headerValue(event.headers, ["ik-appid"]);
  if (!signature || !signatureSecret || !receivedAppId || !safeCompare(receivedAppId, String(applicationId || "").trim())) return false;

  const path = callbackPathname(event);
  const canonicalBody = callbackBodyForSigning(event);
  const cleaned = String(signature).replace(/^sha256=/i, "");
  return callbackSignatureCandidates({ eventPath: path, canonicalBody, signatureSecret })
    .some((candidate) => safeCompare(cleaned, candidate));
};

const isVerifiedIkhokhaConfirmation = (event) => verifyIkhokhaCallbackSignature(event);

const handleConfirmation = async (event) => {
  const correlationId = event.headers["x-correlation-id"] || event.headers["X-Correlation-Id"] || randomUUID();
  const body = parseCallbackBody(event);
  const signatureVerified = isVerifiedIkhokhaConfirmation(event);
  if (!signatureVerified) {
    const unverifiedReference = extractPaymentReference(body) || event.queryStringParameters?.order;
    console.warn("iKhokha payment callback rejected", { correlationId, eventType: "callback", signatureVerified, externalTransactionID: String(unverifiedReference || "").slice(0, 80), responseStatus: 401 });
    return json(401, { ok: false, error: "Invalid iKhokha signature." });
  }
  const order = extractPaymentReference(body) || event.queryStringParameters?.order;
  if (!order) return json(400, { ok: false, error: "Missing payment reference." });
  const orders = await readList(ORDERS_KEY);
  const storedIndex = findPaymentOrderIndex(orders, body, order);
  const stored = storedIndex >= 0 ? orders[storedIndex] : null;
  const data = body.data && typeof body.data === "object" ? body.data : body;
  const mapped = extractPaymentStatus(body);
  const callbackAmount = objectValue(body, ["amount"]);
  const callbackCurrency = objectValue(body, ["currency"]);
  const amountMatches = mapped === "Paid" && amountsMatch(stored?.total, callbackAmount);
  const currencyMatches = String(callbackCurrency || "ZAR").toUpperCase() === "ZAR";
  const callbackPaylinkId = extractPaylinkId(body);
  const paylinkMatches = !callbackPaylinkId || !stored?.ikhokhaPaylinkId || callbackPaylinkId === stored.ikhokhaPaylinkId;
  console.info("iKhokha payment callback", { correlationId, eventType: "callback", externalTransactionID: String(order).slice(0, 80), paylinkID: callbackPaylinkId.slice(0, 80), responseCode: extractResponseCode(body), providerStatus: mapped, signatureVerified, referenceMatched: Boolean(stored), paylinkMatched: paylinkMatches, amountMatched: amountMatches, currencyMatched: currencyMatches });
  if (!stored) return json(404, { ok: false, error: "Unknown payment reference." });
  const currency = String(callbackCurrency || "ZAR").toUpperCase();
  if (currency !== "ZAR") return json(409, { ok: false, error: "Payment currency mismatch." });
  if (!paylinkMatches) return json(409, { ok: false, error: "Payment PayLink mismatch." });
  if (extractPaymentStatus(body) === "Paid" && !amountsMatch(stored.total, callbackAmount)) return json(409, { ok: false, error: "Payment amount mismatch." });
  if (mapped === "Unknown") { console.warn("Unknown iKhokha payment status", { reference: String(order).slice(0, 80), status: String(data.status || data.event || "").slice(0, 40) }); return json(400, { ok: false, error: "Unknown payment status." }); }
  if (mapped === "Paid") { const paid = await markOrderPaid(order, body); console.info("iKhokha payment callback persisted", { correlationId, finalInternalStatus: paid ? "Paid" : "Unchanged", responseStatus: 200 }); return json(200, { ok: true, paid }); }
  if (mapped === "Cancelled" || mapped === "Failed" || mapped === "Refunded" || mapped === "Partially Refunded") return json(200, { ok: true, paymentStatus: mapped, updated: await markOrderCancelled(order, body, mapped) });
  return json(200, { ok: true, paymentStatus: "Pending" });
};

export const handleReconciliation = async (event, { trustedAdmin = false, callbackPayload = null } = {}) => {
  const token = event.headers["x-reconciliation-token"] || event.headers["X-Reconciliation-Token"];
  if (!trustedAdmin && (!process.env.IKHOKHA_RECONCILIATION_TOKEN || token !== process.env.IKHOKHA_RECONCILIATION_TOKEN)) return json(401, { ok: false, code: "RECONCILIATION_AUTH_REQUIRED", error: "Reconciliation authentication required." });
  const requested = String(event.queryStringParameters?.order || parseJson(event).orderNumber || "").trim();
  if (!requested) return json(400, { ok: false, error: "Order number is required." });
  const orders = await readList(ORDERS_KEY);
  const stored = orders.find((item) => normaliseReference(item.orderNumber) === normaliseReference(requested));
  if (!stored) return json(404, { ok: false, error: "Unknown order number." });
  const verifyEndpoint = "/public-api/v1/api/getStatus";
  const missingConfiguration = ["IKHOKHA_API_KEY", "IKHOKHA_API_SECRET"].filter((name) => !String(process.env[name] || "").trim());
  if (missingConfiguration.length) return json(503, { ok: false, code: "RECONCILIATION_CONFIG_MISSING", error: "Payment reconciliation is not configured on the server.", missing: missingConfiguration });
  const paylinkId = String(stored.ikhokhaPaylinkId || "").trim();
  const externalTransactionID = String(stored.externalTransactionID || stored.orderNumber).trim();
  const path = paylinkId
    ? `${verifyEndpoint}/${encodeURIComponent(paylinkId)}`
    : `${verifyEndpoint}/external?externalReference=${encodeURIComponent(externalTransactionID)}`;
  const requestBody = "";
  const baseUrl = ikhokhaBaseUrl();
  const appId = String(process.env.IKHOKHA_API_KEY || "").trim();
  const requestUrl = `${baseUrl}${path}`;
  const signedRequest = createIkhokhaSignedRequest({ requestUrl, serializedBody: requestBody, secret: process.env.IKHOKHA_API_SECRET, escapePayload: false, method: "GET" });
  const signature = signedRequest.signature;
  let response;
  try {
    console.info("Sending verification request to iKhokha", { signingPath: path, signingBodyLength: requestBody.length, signingPayloadLength: path.length + requestBody.length, digestEncoding: "hex", digestCharacterLength: signature.length, secretByteLength: Buffer.byteLength(String(process.env.IKHOKHA_API_SECRET || "").trim(), "utf8") });
    response = await fetch(requestUrl, { method: "GET", headers: { Accept: "application/json", "IK-APPID": appId, "IK-SIGN": signature } });
  } catch (error) {
    console.error("iKhokha reconciliation network failure", { verificationBaseUrl: baseUrl, verificationPath: path, externalTransactionID: stored.orderNumber, requestHeaders: { Accept: "application/json" }, appIdPresent: Boolean(appId), signaturePresent: Boolean(signature), errorName: error?.name, errorCode: error?.code, errorMessage: error?.message });
    return json(502, { ok: false, code: "IKHOKHA_VERIFICATION_FAILED", error: "iKhokha verification request failed." });
  }
  const responseText = await response.text();
  const contentType = response.headers.get("content-type") || "";
  let body = {};
  try { body = responseText && /json/i.test(contentType) ? JSON.parse(responseText) : {}; } catch (error) {
    console.error("iKhokha reconciliation response JSON parse failure", { verificationBaseUrl: baseUrl, verificationPath: path, externalTransactionID: stored.orderNumber, httpStatus: response.status, responseBodyLength: responseText.length, errorName: error?.name });
  }
  const responseSummary = body && typeof body === "object" && Object.keys(body).length ? { status: body.status || body.paymentStatus || body.transactionStatus, responseCode: body.responseCode, message: body.message, error: body.error, keys: Object.keys(body).slice(0, 30) } : { contentType, bodyLength: responseText.length, summary: responseText.replace(/[^\w .-]/g, " ").slice(0, 120) };
  console.info(`iKhokha reconciliation outcome ${JSON.stringify({ orderNumber: stored.orderNumber, httpStatus: response.status, status: response.ok ? "response-received" : "failed" })}`);
  if (!response.ok) return json(502, { ok: false, code: response.status === 400 ? "IKHOKHA_BAD_REQUEST" : "IKHOKHA_VERIFICATION_FAILED", message: response.status === 400 ? "iKhokha rejected the payment-status request." : "iKhokha verification request failed.", error: response.status === 400 ? "iKhokha rejected the payment-status request." : "iKhokha verification request failed." });
  const status = extractPaymentStatus(body);
  const data = body.data && typeof body.data === "object" ? body.data : body;
  const verifiedExternal = String(extractPaymentReference(body) || "").trim();
  const verifiedPaylink = extractPaylinkId(body);
  if (verifiedExternal && normaliseReference(verifiedExternal) !== normaliseReference(externalTransactionID)) return json(409, { ok: false, code: "IKHOKHA_TRANSACTION_MISMATCH", error: "iKhokha returned a different transaction." });
  if (paylinkId && verifiedPaylink && verifiedPaylink !== paylinkId) return json(409, { ok: false, code: "IKHOKHA_PAYLINK_MISMATCH", error: "iKhokha returned a different PayLink." });
  if (status !== "Paid" || String(data.currency || "ZAR").toUpperCase() !== "ZAR" || !amountsMatch(stored.total, data.amount)) return json(409, { ok: false, code: "IKHOKHA_VERIFICATION_FAILED", error: "iKhokha could not confirm this transaction." });
  const updated = await markOrderPaid(stored.orderNumber, { ...body, callbackPayload: safeProviderBody(callbackPayload), data: { ...data, reconciliation: true } });
  return json(200, { ok: true, reconciled: updated, orderNumber: stored.orderNumber });
};

const wantsJson = (event) => {
  const accept = event.headers.accept || event.headers.Accept || "";
  return accept.includes("application/json");
};

export const handler = async (event) => {
  connectBlobContext(event);
  if (event.queryStringParameters?.action === "reconcile") return handleReconciliation(event);
  if (event.queryStringParameters?.action === "confirm") {
    return handleConfirmation(event);
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  const body = parseJson(event);
  const address = {
    streetAddress: String(body.address?.streetAddress || body.customer?.address?.streetAddress || "").trim(),
    suburb: String(body.address?.suburb || body.customer?.address?.suburb || "").trim(),
    city: String(body.address?.city || body.customer?.address?.city || "").trim(),
    province: String(body.address?.province || body.customer?.address?.province || "").trim(),
    postalCode: String(body.address?.postalCode || body.customer?.address?.postalCode || "").trim(),
  };
  const customer = {
    name: String(body.customer?.name || body.name || "").trim(),
    email: String(body.customer?.email || body.email || "").trim(),
    phone: String(body.customer?.phone || body.phone || "").trim(),
    address,
    notes: String(body.customer?.notes || body.notes || "").trim(),
  };
  let deliveryOption;
  try {
    deliveryOption = normaliseDeliveryMethod(body.delivery?.option || body.deliveryOption || "collection");
  } catch (error) {
    return json(400, { error: error.message });
  }
  const content = await readContent();
  const deliverySettings = sanitiseDeliverySettings(content.deliverySettings);
  if (deliveryOption === "collection" && !deliverySettings.collectionEnabled) {
    return json(400, { error: "Collection is currently unavailable. Please select Pudo Locker Delivery." });
  }
  const delivery = {
    option: deliveryOption,
    label: deliveryOption === "pudo"
      ? "Pudo Locker Delivery"
      : deliveryOption === DOOR_TO_DOOR_METHOD ? "Door-to-Door Delivery" : "Collect from Lullubelle – Centurion",
    fee: deliveryOption === "pudo" ? deliverySettings.standardPudoFee : deliveryOption === DOOR_TO_DOOR_METHOD ? DOOR_TO_DOOR_FEE : 0,
  };

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email);
  const phoneValid = customer.phone.replace(/\D/g, "").length >= 7;
  if (!customer.name || !emailValid || !phoneValid) {
    return json(400, { error: "A valid customer name, email address and mobile number are required." });
  }

  if (delivery.option !== "collection" && (!address.streetAddress || !address.suburb || !address.city || !address.province || !address.postalCode)) {
    return json(400, { error: `Street address, suburb, city, province and postal code are required for ${delivery.label}.` });
  }

  try {
    const products = await normaliseItems(body.items || body.products);
    const subtotal = money(products.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0));
    const standardDeliveryFee = money(delivery.fee);
    let discount = body.promoCode ? await validatePromo({ code: body.promoCode, email: customer.email, products, subtotal, deliveryFee: standardDeliveryFee }) : null;
    const deliveryCalculation = calculateDelivery({ productSubtotal: subtotal, productDiscount: discount?.productDiscount || 0, deliveryOption, settings: deliverySettings });
    if (discount) {
      const discountRules = deliveryOption === DOOR_TO_DOOR_METHOD ? { ...discount.discount, freeDelivery: false } : discount.discount;
      discount = { discount: discount.discount, ...calculateDiscount({ discount: discountRules, products, subtotal, deliveryFee: deliveryCalculation.deliveryFee }) };
    }
    const originalDeliveryFee = deliveryCalculation.deliveryFee;
    if (event.queryStringParameters?.action === "validate-promo") {
      return json(200, { ok: true, promoCode: discount?.discount.code || "", discountAmount: discount?.discountAmount || 0, productDiscount: discount?.productDiscount || 0, deliveryFee: discount?.deliveryFee ?? originalDeliveryFee, total: discount?.total ?? money(subtotal + originalDeliveryFee), freeDeliveryApplied: deliveryCalculation.freeDeliveryApplied, qualifyingSubtotal: deliveryCalculation.qualifyingSubtotal, deliverySettings, message: discount ? `${discount.discount.code} applied.` : "Enter a promo code." });
    }
    const missing = ["IKHOKHA_API_KEY", "IKHOKHA_API_SECRET"].filter((key) => !process.env[key]);
    if (missing.length) return json(500, { error: `Missing iKhokha environment variables: ${missing.join(", ")}` });
    const deliveryFee = discount?.deliveryFee ?? originalDeliveryFee;
    const total = Math.max(0, discount?.total ?? money(subtotal + deliveryFee));
    const submittedTotal = body.finalTotal ?? body.totalAmount ?? body.total;
    if (submittedTotal !== undefined && Math.abs(money(submittedTotal) - total) > 0.01) {
      return json(400, { error: "Order total mismatch. Please refresh your cart and try again." });
    }
    const fingerprint = checkoutFingerprint({ customer, products, total, delivery });
    const suppliedAttemptId = String(body.paymentAttemptId || "").trim();
    let paymentAttemptId = suppliedAttemptId || fingerprint;
    let recordKey = attemptKey(paymentAttemptId);
    const paymentReference = orderNumber();
    let recoveryOrder = null;
    const initialAttempt = {
      paymentAttemptId,
      checkoutFingerprint: fingerprint,
      externalTransactionID: paymentReference,
      state: "creating",
      createdAt: new Date().toISOString(),
    };
    let claimed = await createRecord(recordKey, initialAttempt);
    if (claimed.modified && !claimed.etag) throw new Error("Payment attempt claim did not return a storage version.");
    let attempt = claimed.modified ? { value: initialAttempt, etag: claimed.etag } : await readPaymentAttempt(recordKey);
    const attemptAge = Date.now() - Date.parse(String(attempt.value?.updatedAt || attempt.value?.createdAt || ""));
    if (!claimed.modified && attempt.value && Number.isFinite(attemptAge) && attemptAge > PAYMENT_ATTEMPT_TTL_MS && !["paid", "refunded"].includes(String(attempt.value.state || "").toLowerCase())) {
      // An abandoned attempt is eligible for a genuinely new purchase after
      // the bounded recovery window; preserve the old record and references.
      paymentAttemptId = `${paymentAttemptId}-retry-${Date.now()}`;
      recordKey = attemptKey(paymentAttemptId);
      const freshReference = orderNumber();
      const freshAttempt = { paymentAttemptId, checkoutFingerprint: fingerprint, externalTransactionID: freshReference, state: "creating", createdAt: new Date().toISOString() };
      const freshClaim = await createRecord(recordKey, freshAttempt);
      if (!freshClaim.modified || !freshClaim.etag) return json(409, { ok: false, code: "PAYMENT_ATTEMPT_IN_PROGRESS", error: "A new payment attempt is already being prepared. Please retry shortly." });
      claimed = freshClaim;
      attempt = { value: freshAttempt, etag: freshClaim.etag };
    }
    if (!claimed.modified) {
      if (!attempt.value || attempt.value.checkoutFingerprint !== fingerprint) return json(409, { ok: false, code: "PAYMENT_ATTEMPT_MISMATCH", error: "This payment attempt belongs to a different checkout." });
      const existing = (await readList(ORDERS_KEY)).find((item) => normaliseReference(item.externalTransactionID || item.orderNumber) === normaliseReference(attempt.value.externalTransactionID));
      if (existing && terminalPaymentStatus(existing)) return json(409, { ok: false, code: "ORDER_ALREADY_PAID", error: "This order has already been paid and cannot start another payment attempt.", orderNumber: existing.orderNumber });
      if (existing?.paymentUrl) return json(200, { ok: true, recovered: true, orderNumber: existing.orderNumber, externalTransactionID: existing.externalTransactionID || existing.orderNumber, paymentUrl: existing.paymentUrl, testMode: toBoolean(process.env.IKHOKHA_TEST_MODE) });
      if (!existing) return json(409, { ok: false, code: "PAYMENT_ATTEMPT_IN_PROGRESS", error: "The existing payment attempt is still being prepared. Please retry shortly.", externalTransactionID: attempt.value.externalTransactionID });
      recoveryOrder = existing;
    }
    const stablePaymentReference = attempt.value?.externalTransactionID || paymentReference;
    const reservationId = recoveryOrder?.discountReservationId || (discount ? await reserveRedemption({ discount: discount.discount, email: customer.email, orderNumber: stablePaymentReference }) : "");
    const order = recoveryOrder || await createPendingOrder({
      customer,
      delivery: { ...delivery, fee: deliveryFee, freeDeliveryApplied: deliveryCalculation.freeDeliveryApplied },
      address,
      notes: customer.notes,
      products,
      subtotal,
      originalSubtotal: subtotal,
      discount,
      deliveryFee,
      deliveryCalculation,
      total,
      paymentReference: stablePaymentReference,
      reservationId,
      paymentAttemptId,
      fingerprint,
    });
    const testMode = toBoolean(process.env.IKHOKHA_TEST_MODE);
    let checkout;
    try {
      checkout = await callIkhokha({ event, order, testMode });
    } catch (error) {
      await releaseRedemption(reservationId);
      const orders = await readList(ORDERS_KEY);
      const failed = orders.find((item) => item.orderNumber === order.orderNumber);
      if (failed) {
        failed.paymentStatus = "Failed";
        failed.orderStatus = "Cancelled";
        failed.checkoutError = error.message;
        await writeList(ORDERS_KEY, orders);
      }
      throw error;
    }

    const ikhokhaPaylinkId = extractPaylinkId(checkout.providerResponse);
    if (ikhokhaPaylinkId) await persistPaylinkOrder(order, ikhokhaPaylinkId, checkout.paymentUrl);
    if (!ikhokhaPaylinkId) console.warn(`iKhokha checkout response missing paylink ID ${JSON.stringify({ orderNumber: order.orderNumber })}`);
    await updateRecord(recordKey, { ...attempt.value, state: "active", orderNumber: order.orderNumber, externalTransactionID: order.externalTransactionID, paylinkID: ikhokhaPaylinkId || "", paymentUrl: checkout.paymentUrl, updatedAt: new Date().toISOString() }, attempt.etag);

    if (!wantsJson(event)) {
      return {
        statusCode: 303,
        headers: mergeSecurityHeaders({
          Location: checkout.paymentUrl,
          "Cache-Control": "no-store",
        }, apiSecurityHeaders),
        body: "",
      };
    }

    return json(200, {
      ok: true,
      orderNumber: order.orderNumber,
      externalTransactionID: order.externalTransactionID,
      paymentUrl: checkout.paymentUrl,
      testMode,
    });
  } catch (error) {
    return json(error.diagnostic ? 502 : 400, {
      error: error.message || "Unable to start iKhokha checkout.",
      diagnostic: error.diagnostic || {
        step: "Checkout function",
        error: error.message || "Unable to start iKhokha checkout.",
      },
    });
  }
};
