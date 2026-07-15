import {
  ORDERS_KEY,
  connectBlobContext,
  json,
  newId,
  parseJson,
  readContent,
  readList,
  writeList,
} from "./_admin-shared.mjs";
import { calculateDiscount, releaseRedemption, reserveRedemption, validatePromo } from "./_discounts.mjs";
import { calculateDelivery, sanitiseDeliverySettings } from "./_delivery.mjs";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

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

const normaliseReference = (value) => String(value ?? "").trim().toLowerCase();
export const extractPaymentReference = (payload = {}) => {
  const data = payload.data && typeof payload.data === "object" ? payload.data : payload;
  return [data.externalTransactionID, data.merchantReference, data.orderNumber, data.orderId, data.paymentReference, data.reference, payload.externalTransactionID, payload.merchantReference, payload.orderNumber, payload.orderId, payload.paymentReference, payload.reference]
    .find((value) => String(value ?? "").trim()) || "";
};
export const extractPaymentStatus = (payload = {}) => {
  const data = payload.data && typeof payload.data === "object" ? payload.data : payload;
  return mapIkhokhaStatus(data.status || data.paymentStatus || data.transactionStatus || data.result || data.event || payload.status || payload.paymentStatus || payload.transactionStatus || payload.result || payload.event);
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

export const createIkhokhaSignature = ({ requestUrl, serializedBody = "", secret, escapePayload = true }) => {
  const urlText = String(requestUrl);
  const uri = urlText.includes("//") ? urlText.slice(urlText.indexOf("//") + 2) : urlText;
  const slashIndex = uri.indexOf("/");
  const basePath = slashIndex >= 0 ? uri.slice(slashIndex) : "/";
  const signingPayload = basePath + serializedBody;
  return createHmac("sha256", String(secret || "").trim())
    .update(escapePayload ? escapeIkhokhaSignatureString(signingPayload) : signingPayload, "utf8")
    .digest("hex");
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
  const data = payload.data && typeof payload.data === "object" ? payload.data : payload;
  return String(data.paylinkID || data.paylinkId || "").trim();
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
      category: product.category || "",
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

const createPendingOrder = async ({ customer, delivery, address, notes, products, subtotal, originalSubtotal, discount, deliveryFee, deliveryCalculation, total, paymentReference, reservationId }) => {
  const order = {
    id: newId("order"),
    orderNumber: paymentReference,
    createdAt: new Date().toISOString(),
    customer,
    delivery,
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
  const orders = await readList(ORDERS_KEY);
  orders.unshift(order);
  await writeList(ORDERS_KEY, orders.slice(0, 500));
  return order;
};

const persistPaylinkOrder = async (pendingOrder, paylinkId) => {
  const latestOrders = await readList(ORDERS_KEY);
  const index = latestOrders.findIndex((item) => item.orderNumber === pendingOrder.orderNumber);
  const enriched = index >= 0
    ? { ...latestOrders[index], ikhokhaPaylinkId: paylinkId }
    : { ...pendingOrder, ikhokhaPaylinkId: paylinkId };
  const nextOrders = index >= 0
    ? latestOrders.map((item, itemIndex) => itemIndex === index ? enriched : item)
    : [enriched, ...latestOrders.filter((item) => item.orderNumber !== pendingOrder.orderNumber)].slice(0, 500);
  await writeList(ORDERS_KEY, nextOrders);
  const verified = (await readList(ORDERS_KEY)).find((item) => item.orderNumber === pendingOrder.orderNumber);
  if (!verified || verified.ikhokhaPaylinkId !== paylinkId) throw new Error("Unable to verify iKhokha paylink persistence.");
  return verified;
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
  console.info(`iKhokha checkout request metadata ${JSON.stringify(requestLog)}`);

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
    console.error(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "throw-network", httpStatus: null, errorName: detail.name, errorCode: detail.code || null, responseType: "network-error" })}`);
    throw detail;
  }

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  console.info(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "provider-response-parsed", orderNumber: order.orderNumber })}`);

  console.info(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "before-response-headers-shape" })}`);
  let safeResponseHeaders;
  try {
    safeResponseHeaders = responseHeadersObject(response.headers);
  } catch (error) {
    console.error(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "response-headers-shape-failed", errorName: error?.name || "Error", errorCode: error?.code || null })}`);
    throw error;
  }
  console.info(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "after-response-headers-shape" })}`);
  console.info(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "before-provider-shape" })}`);
  let safeProviderShape;
  try {
    safeProviderShape = providerShape(data);
  } catch (error) {
    console.error(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "provider-shape-failed", errorName: error?.name || "Error", errorCode: error?.code || null })}`);
    throw error;
  }
  console.info(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "after-provider-shape" })}`);
  const responseLog = {
    step: "iKhokha checkout response received",
    ...requestLog,
    testMode,
    status: response.status,
    statusText: response.statusText,
    responseShape: safeProviderShape,
  };
  console.info(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "after-response-log-construction" })}`);
  console.info(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "before-http-status-validation", httpStatus: response.status, responseType: typeof data })}`);
  logIkhokhaDiagnostic(
    response.ok ? "info" : "error",
    response.ok ? "iKhokha checkout response received." : "iKhokha checkout request rejected.",
    responseLog,
  );

  if (!response.ok) {
    console.info(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "before-throw-http-status", httpStatus: response.status, errorName: "IkhokhaHttpError", errorCode: `HTTP_${response.status}`, responseType: typeof data })}`);
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
  console.info(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "after-http-status-validation", httpStatus: response.status, responseType: typeof data })}`);

  console.info(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "before-payment-url-extraction", httpStatus: response.status, responseType: typeof data })}`);
  const paymentUrl = extractPaymentUrl(data);
  console.info(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "after-payment-url-extraction", httpStatus: response.status, hasPaymentUrl: Boolean(paymentUrl) })}`);
  if (!paymentUrl) {
    console.info(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "before-throw-missing-payment-url", httpStatus: response.status, errorName: "MissingPaymentUrlError", errorCode: "PAYMENT_URL_MISSING", responseType: typeof data })}`);
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

  console.info(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "before-provider-response-return", httpStatus: response.status, responseType: typeof data })}`);
  return { paymentUrl, providerResponse: data };
};

const markOrderPaid = async (orderNumber, providerPayload) => {
  const orders = await readList(ORDERS_KEY);
  const index = orders.findIndex((order) => normaliseReference(order.orderNumber) === normaliseReference(orderNumber));
  if (index === -1) return false;
  const order = orders[index];
  const data = providerPayload.data && typeof providerPayload.data === "object" ? providerPayload.data : providerPayload;
  const callbackPaylinkId = String(data.paylinkID || data.paylinkId || "").trim();
  if (callbackPaylinkId && order.ikhokhaPaylinkId && callbackPaylinkId !== order.ikhokhaPaylinkId) console.warn("iKhokha paylink ID conflict", { orderNumber, stored: order.ikhokhaPaylinkId, received: callbackPaylinkId });
  const transactionId = String(data.transactionID || data.transactionId || data.transaction_id || data.paylinkID || data.paylinkId || "").trim();
  const eventKey = transactionId || normaliseReference(orderNumber);
  const history = Array.isArray(order.paymentEvents) ? order.paymentEvents : [];
  if (history.some((event) => event.idempotencyKey === eventKey)) return true;
  const now = new Date().toISOString();
  orders[index] = {
    ...order,
    ikhokhaPaylinkId: order.ikhokhaPaylinkId || callbackPaylinkId || null,
    paymentStatus: "Paid",
    orderStatus: order.orderStatus === "New" ? "Processing" : order.orderStatus,
    paymentProvider: "iKhokha iK Pay",
    paymentReference: String(extractPaymentReference(providerPayload) || order.orderNumber),
    transactionId,
    paidAmount: money(Number(data.amount) >= 100 ? Number(data.amount) / 100 : data.amount),
    currency: String(data.currency || "ZAR").toUpperCase(),
    paidAt: data.paidAt || now,
    paymentUpdatedAt: now,
    paymentVerifiedAt: now,
    verificationSource: data.reconciliation ? "reconciliation" : "webhook",
    providerConfirmation: safeProviderBody(providerPayload),
    paymentEvents: [...history, { timestamp: now, providerStatus: "paid", internalStatus: "Paid", transactionReference: transactionId || String(orderNumber), amount: money(Number(data.amount) >= 100 ? Number(data.amount) / 100 : data.amount), verificationResult: "verified", eventSource: "ikhokha-webhook", idempotencyKey: eventKey }],
  };
  await writeList(ORDERS_KEY, orders);
  return true;
};

const markOrderCancelled = async (orderNumber, providerPayload, internalStatus = "Cancelled") => {
  const orders = await readList(ORDERS_KEY);
  const index = orders.findIndex((order) => normaliseReference(order.orderNumber) === normaliseReference(orderNumber));
  if (index === -1) return false;

  await releaseRedemption(orders[index].discountReservationId);

  if (orders[index].paymentStatus === "Paid") return true;
  const now = new Date().toISOString();
  const history = Array.isArray(orders[index].paymentEvents) ? orders[index].paymentEvents : [];
  const data = providerPayload.data && typeof providerPayload.data === "object" ? providerPayload.data : providerPayload;
  const callbackPaylinkId = String(data.paylinkID || data.paylinkId || "").trim();
  const transactionId = String(data.transactionID || data.transactionId || data.transaction_id || data.paylinkID || "").trim();
  orders[index] = {
    ...orders[index],
    ikhokhaPaylinkId: orders[index].ikhokhaPaylinkId || callbackPaylinkId || null,
    paymentStatus: internalStatus,
    orderStatus: internalStatus === "Cancelled" ? "Cancelled" : orders[index].orderStatus,
    cancelledAt: internalStatus === "Cancelled" ? now : orders[index].cancelledAt,
    paymentUpdatedAt: now,
    providerConfirmation: safeProviderBody(providerPayload),
    paymentEvents: [...history, { timestamp: now, providerStatus: internalStatus.toLowerCase(), internalStatus, transactionReference: transactionId || String(orderNumber), amount: money(Number(data.amount) >= 100 ? Number(data.amount) / 100 : data.amount), verificationResult: "verified", eventSource: "ikhokha-webhook", idempotencyKey: transactionId || `${normaliseReference(orderNumber)}:${internalStatus}` }],
  };
  await writeList(ORDERS_KEY, orders);
  return true;
};

const safeCompare = (left, right) => {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
};

// Keep the provider-specific string-to-sign isolated here. Replace only this
// function when iKhokha supplies its official webhook specification.
export const callbackSignatureCandidates = ({ rawBodyBytes, eventPath, signatureSecret }) => {
  const body = Buffer.from(rawBodyBytes);
  const secret = String(signatureSecret || "").trim();
  return [
    createHmac("sha256", secret).update(body).digest("hex"),
    createHmac("sha256", secret).update(body).digest("base64"),
    createHmac("sha256", secret).update(escapeIkhokhaSignatureString(`${eventPath}${body.toString("utf8")}`)).digest("hex"),
  ];
};

const verifySignature = (event) => {
  const signature = event.headers["x-ikhokha-signature"]
    || event.headers["X-iKhokha-Signature"]
    || event.headers["x-ik-signature"]
    || event.headers["X-iK-Signature"]
    || event.headers["x-signature"]
    || event.headers["X-Signature"]
    || event.headers["ik-sign"]
    || event.headers["IK-SIGN"]
    || event.headers["ik-signature"]
    || event.headers["IK-Signature"];
  if (!signature || !process.env.IKHOKHA_API_SECRET) return false;

  const body = event.isBase64Encoded ? Buffer.from(event.body || "", "base64") : Buffer.from(event.body || "", "utf8");
  const path = event.path || "/.netlify/functions/ikhokha-checkout";
  const cleaned = String(signature).replace(/^sha256=/i, "");
  return callbackSignatureCandidates({ rawBodyBytes: body, eventPath: path, signatureSecret: process.env.IKHOKHA_API_SECRET })
    .some((candidate) => safeCompare(cleaned, candidate));
};

const isVerifiedIkhokhaConfirmation = (event) => verifySignature(event);

const handleConfirmation = async (event) => {
  const correlationId = event.headers["x-correlation-id"] || event.headers["X-Correlation-Id"] || randomUUID();
  const signatureVerified = isVerifiedIkhokhaConfirmation(event);
  if (!signatureVerified) {
    console.warn("iKhokha payment callback", { correlationId, eventType: "callback", signatureVerified, responseStatus: 401 });
    return json(401, { ok: false, error: "Invalid iKhokha signature." });
  }
  const body = parseJson(event);
  const order = extractPaymentReference(body) || event.queryStringParameters?.order;
  if (!order) return json(400, { ok: false, error: "Missing payment reference." });
  const orders = await readList(ORDERS_KEY);
  const stored = orders.find((item) => normaliseReference(item.orderNumber) === normaliseReference(order));
  const data = body.data && typeof body.data === "object" ? body.data : body;
  const mapped = extractPaymentStatus(body);
  const amountMatches = mapped === "Paid" && amountsMatch(stored?.total, data.amount);
  const currencyMatches = String(data.currency || "ZAR").toUpperCase() === "ZAR";
  console.info("iKhokha payment callback", { correlationId, eventType: "callback", orderNumber: String(order).slice(0, 80), providerStatus: mapped, signatureVerified, referenceMatched: Boolean(stored), amountMatched: amountMatches, currencyMatched: currencyMatches });
  if (!stored) return json(404, { ok: false, error: "Unknown payment reference." });
  const currency = String(data.currency || "ZAR").toUpperCase();
  if (currency !== "ZAR") return json(409, { ok: false, error: "Payment currency mismatch." });
  if (extractPaymentStatus(body) === "Paid" && !amountsMatch(stored.total, data.amount)) return json(409, { ok: false, error: "Payment amount mismatch." });
  if (mapped === "Unknown") { console.warn("Unknown iKhokha payment status", { reference: String(order).slice(0, 80), status: String(data.status || data.event || "").slice(0, 40) }); return json(400, { ok: false, error: "Unknown payment status." }); }
  if (mapped === "Paid") { const paid = await markOrderPaid(order, body); console.info("iKhokha payment callback persisted", { correlationId, finalInternalStatus: paid ? "Paid" : "Unchanged", responseStatus: 200 }); return json(200, { ok: true, paid }); }
  if (mapped === "Cancelled" || mapped === "Failed" || mapped === "Refunded" || mapped === "Partially Refunded") return json(200, { ok: true, paymentStatus: mapped, updated: await markOrderCancelled(order, body, mapped) });
  return json(200, { ok: true, paymentStatus: "Pending" });
};

export const handleReconciliation = async (event, { trustedAdmin = false } = {}) => {
  const token = event.headers["x-reconciliation-token"] || event.headers["X-Reconciliation-Token"];
  if (!trustedAdmin && (!process.env.IKHOKHA_RECONCILIATION_TOKEN || token !== process.env.IKHOKHA_RECONCILIATION_TOKEN)) return json(401, { ok: false, code: "RECONCILIATION_AUTH_REQUIRED", error: "Reconciliation authentication required." });
  const requested = String(event.queryStringParameters?.order || parseJson(event).orderNumber || "").trim();
  if (!requested) return json(400, { ok: false, error: "Order number is required." });
  const orders = await readList(ORDERS_KEY);
  const stored = orders.find((item) => normaliseReference(item.orderNumber) === normaliseReference(requested));
  console.info(`iKhokha reconciliation checkpoint ${JSON.stringify({ stage: "order-read", orderNumber: requested, found: Boolean(stored), paylinkIdPresent: Boolean(stored?.ikhokhaPaylinkId) })}`);
  if (!stored) return json(404, { ok: false, error: "Unknown order number." });
  const verifyEndpoint = "/public-api/v1/api/getStatus";
  const missingConfiguration = ["IKHOKHA_API_KEY", "IKHOKHA_API_SECRET"].filter((name) => !String(process.env[name] || "").trim());
  if (missingConfiguration.length) return json(503, { ok: false, code: "RECONCILIATION_CONFIG_MISSING", error: "Payment reconciliation is not configured on the server.", missing: missingConfiguration });
  const paylinkId = String(stored.ikhokhaPaylinkId || "").trim();
  if (!paylinkId) return json(409, { ok: false, code: "IKHOKHA_PAYLINK_ID_MISSING", error: "This order has no stored iKhokha paylink ID and cannot be queried through the documented status endpoint." });
  const path = `${verifyEndpoint}/${encodeURIComponent(paylinkId)}`;
  const requestBody = "";
  const baseUrl = ikhokhaBaseUrl();
  const appId = String(process.env.IKHOKHA_API_KEY || "").trim();
  const requestUrl = `${baseUrl}${path}`;
  const signature = createIkhokhaSignature({ requestUrl, serializedBody: requestBody, secret: process.env.IKHOKHA_API_SECRET, escapePayload: false });
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
  console.info("iKhokha reconciliation response", { httpStatus: response.status, contentType, verificationBaseUrl: baseUrl, verificationPath: path, externalTransactionID: stored.orderNumber, requestHeaders: { Accept: "application/json" }, appIdPresent: Boolean(appId), signaturePresent: Boolean(signature), responseBody: responseSummary, responseBodyLength: responseText.length });
  if (!response.ok) return json(502, { ok: false, code: response.status === 400 ? "IKHOKHA_BAD_REQUEST" : "IKHOKHA_VERIFICATION_FAILED", message: response.status === 400 ? "iKhokha rejected the payment-status request." : "iKhokha verification request failed.", error: response.status === 400 ? "iKhokha rejected the payment-status request." : "iKhokha verification request failed." });
  const status = extractPaymentStatus(body);
  const data = body.data && typeof body.data === "object" ? body.data : body;
  if (status !== "Paid" || String(data.currency || "ZAR").toUpperCase() !== "ZAR" || !amountsMatch(stored.total, data.amount)) return json(409, { ok: false, code: "IKHOKHA_VERIFICATION_FAILED", error: "iKhokha could not confirm this transaction." });
  const updated = await markOrderPaid(stored.orderNumber, { ...body, data: { ...data, reconciliation: true } });
  return json(200, { ok: true, reconciled: updated, orderNumber: stored.orderNumber });
};

const wantsJson = (event) => {
  const accept = event.headers.accept || event.headers.Accept || "";
  return accept.includes("application/json");
};

export const handler = async (event) => {
  connectBlobContext(event);
  console.info(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "handler-entered", method: event.httpMethod })}`);
  if (event.queryStringParameters?.action === "reconcile") return handleReconciliation(event);
  if (event.queryStringParameters?.action === "confirm") {
    return handleConfirmation(event);
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  const body = parseJson(event);
  console.info(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "request-body-parsed", method: event.httpMethod })}`);
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
  const deliveryOption = String(body.delivery?.option || body.deliveryOption || "collection").toLowerCase() === "pudo"
    ? "pudo"
    : "collection";
  const content = await readContent();
  const deliverySettings = sanitiseDeliverySettings(content.deliverySettings);
  if (deliveryOption === "collection" && !deliverySettings.collectionEnabled) {
    return json(400, { error: "Collection is currently unavailable. Please select Pudo Locker Delivery." });
  }
  const delivery = {
    option: deliveryOption,
    label: deliveryOption === "pudo" ? "Pudo Locker Delivery" : "Collect from Lullubelle – Centurion",
    fee: deliveryOption === "pudo" ? deliverySettings.standardPudoFee : 0,
  };

  if (!customer.name || !customer.email || !customer.phone) {
    return json(400, { error: "Customer name, email and phone are required." });
  }

  if (delivery.option === "pudo" && (!address.streetAddress || !address.suburb || !address.city || !address.province || !address.postalCode)) {
    return json(400, { error: "Street address, suburb, city, province and postal code are required for Pudo Locker Delivery." });
  }

  try {
    const products = await normaliseItems(body.items || body.products);
    const subtotal = money(products.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0));
    const standardDeliveryFee = money(delivery.fee);
    let discount = body.promoCode ? await validatePromo({ code: body.promoCode, email: customer.email, products, subtotal, deliveryFee: standardDeliveryFee }) : null;
    const deliveryCalculation = calculateDelivery({ productSubtotal: subtotal, productDiscount: discount?.productDiscount || 0, deliveryOption, settings: deliverySettings });
    if (discount) discount = { discount: discount.discount, ...calculateDiscount({ discount: discount.discount, products, subtotal, deliveryFee: deliveryCalculation.deliveryFee }) };
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
    const paymentReference = orderNumber();
    const reservationId = discount ? await reserveRedemption({ discount: discount.discount, email: customer.email, orderNumber: paymentReference }) : "";
    const order = await createPendingOrder({
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
      paymentReference,
      reservationId,
    });
    console.info(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "pending-order-created", orderNumber: order.orderNumber })}`);
    const testMode = toBoolean(process.env.IKHOKHA_TEST_MODE);
    let checkout;
    try {
      console.info(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "before-call", orderNumber: order.orderNumber })}`);
      checkout = await callIkhokha({ event, order, testMode });
      console.info(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "call-returned", orderNumber: order.orderNumber })}`);
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
    console.info(`iKhokha checkout provider response shape ${JSON.stringify({ orderNumber: order.orderNumber, shape: providerShape(checkout.providerResponse) })}`);
    if (ikhokhaPaylinkId) await persistPaylinkOrder(order, ikhokhaPaylinkId);
    if (!ikhokhaPaylinkId) console.warn(`iKhokha checkout response missing paylink ID ${JSON.stringify({ orderNumber: order.orderNumber })}`);

    if (!wantsJson(event)) {
      console.info(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "before-redirect", orderNumber: order.orderNumber })}`);
      return {
        statusCode: 303,
        headers: {
          Location: checkout.paymentUrl,
          "Cache-Control": "no-store",
        },
        body: "",
      };
    }

    console.info(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "before-success-response", orderNumber: order.orderNumber })}`);
    return json(200, {
      ok: true,
      orderNumber: order.orderNumber,
      paymentUrl: checkout.paymentUrl,
      testMode,
    });
  } catch (error) {
    console.error(`iKhokha checkout checkpoint ${JSON.stringify({ stage: "catch", errorName: error?.name || "Error", errorCode: error?.code || null })}`);
    return json(error.diagnostic ? 502 : 400, {
      error: error.message || "Unable to start iKhokha checkout.",
      diagnostic: error.diagnostic || {
        step: "Checkout function",
        error: error.message || "Unable to start iKhokha checkout.",
      },
    });
  }
};
