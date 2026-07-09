import {
  ORDERS_KEY,
  json,
  newId,
  parseJson,
  readContent,
  readList,
  writeList,
} from "./_admin-shared.mjs";
import { createHmac, timingSafeEqual } from "node:crypto";

const toBoolean = (value) => /^(1|true|yes|on)$/i.test(String(value || ""));

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
  if (process.env.IKHOKHA_CHECKOUT_PATH) return process.env.IKHOKHA_CHECKOUT_PATH;
  return "/public-api/v1/api/payment";
};

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const PUDO_DELIVERY_FEE = 80;

const safeProviderBody = (data) => {
  if (!data || typeof data !== "object") return data;
  const blocked = new Set(["authorization", "Authorization", "token", "secret", "apiKey", "apiSecret", "password"]);
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [
    key,
    blocked.has(key) ? "[masked]" : value,
  ]));
};

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

export const generateIkhokhaSignature = ({ path, requestBody, secret }) => createHmac("sha256", secret)
  .update(`${path}${JSON.stringify(requestBody)}`)
  .digest("hex");

export const buildIkhokhaPayload = ({ base, order }) => {
  const amountInCents = Math.round(money(order.total) * 100);
  const encodedOrder = encodeURIComponent(order.orderNumber);
  return {
    amount: amountInCents,
    currency: "ZAR",
    externalTransactionID: order.orderNumber,
    description: `Lullubelle order ${order.orderNumber}`,
    entityID: process.env.IKHOKHA_API_KEY,
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

const extractPaymentUrl = (payload) => {
  const candidates = [
    payload?.paymentUrl,
    payload?.paymentURL,
    payload?.checkoutUrl,
    payload?.checkoutURL,
    payload?.redirectUrl,
    payload?.redirectURL,
    payload?.url,
    payload?.data?.paymentUrl,
    payload?.data?.checkoutUrl,
    payload?.data?.redirectUrl,
    payload?.data?.url,
  ];
  return candidates.find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
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

const createPendingOrder = async ({ customer, delivery, address, notes, products, subtotal, deliveryFee, total, paymentReference }) => {
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
    deliveryFee,
    total,
    paymentProvider: "iKhokha iK Pay",
    paymentStatus: "Pending",
    orderStatus: "New",
  };
  const orders = await readList(ORDERS_KEY);
  orders.unshift(order);
  await writeList(ORDERS_KEY, orders.slice(0, 500));
  return order;
};

const callIkhokha = async ({ event, order, testMode }) => {
  const base = siteUrl(event);
  const payload = buildIkhokhaPayload({ base, order, testMode });

  const path = checkoutEndpoint();
  const requestUrl = `${ikhokhaBaseUrl()}${path}`;
  const signature = generateIkhokhaSignature({
    path,
    requestBody: payload,
    secret: process.env.IKHOKHA_API_SECRET,
  });
  const requestLog = {
    requestUrl,
    method: "POST",
    headers: maskedIkhokhaHeaders(),
    authentication: maskedAuthDiagnostic(),
    signatureInput: `${path} + JSON.stringify(requestBody)`,
    body: payload,
  };
  logIkhokhaDiagnostic("info", "Creating iKhokha hosted checkout.", requestLog);

  let response;
  try {
    response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "IK-APPID": process.env.IKHOKHA_API_KEY,
        "IK-SIGN": signature,
      },
      body: JSON.stringify(payload),
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

  if (!response.ok) {
    const diagnostic = {
      step: "iKhokha rejected checkout request",
      ...requestLog,
      testMode,
      status: response.status,
      statusText: response.statusText,
      responseHeaders: responseHeadersObject(response.headers),
      responseBody: safeProviderBody(data),
      rawResponseBody: text,
    };
    logIkhokhaDiagnostic("error", "iKhokha checkout request rejected.", diagnostic);
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
      responseHeaders: responseHeadersObject(response.headers),
      responseBody: safeProviderBody(data),
      rawResponseBody: text,
    };
    logIkhokhaDiagnostic("error", "iKhokha did not return a hosted payment URL.", diagnostic);
    const detail = new Error("iKhokha did not return a hosted payment URL.");
    detail.publicMessage = "iKhokha did not return a payment page. Please contact Lullubelle for help.";
    detail.diagnostic = diagnostic;
    throw detail;
  }

  return { paymentUrl, providerResponse: data };
};

const markOrderPaid = async (orderNumber, providerPayload) => {
  const orders = await readList(ORDERS_KEY);
  const index = orders.findIndex((order) => order.orderNumber === orderNumber);
  if (index === -1) return false;

  orders[index] = {
    ...orders[index],
    paymentStatus: "Paid",
    orderStatus: orders[index].orderStatus === "New" ? "Processing" : orders[index].orderStatus,
    paidAt: new Date().toISOString(),
    providerConfirmation: providerPayload,
  };
  await writeList(ORDERS_KEY, orders);
  return true;
};

const markOrderCancelled = async (orderNumber, providerPayload) => {
  const orders = await readList(ORDERS_KEY);
  const index = orders.findIndex((order) => order.orderNumber === orderNumber);
  if (index === -1) return false;

  orders[index] = {
    ...orders[index],
    paymentStatus: "Unpaid",
    orderStatus: "Cancelled",
    cancelledAt: new Date().toISOString(),
    providerConfirmation: providerPayload,
  };
  await writeList(ORDERS_KEY, orders);
  return true;
};

const safeCompare = (left, right) => {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
};

const verifySignature = (event) => {
  const signature = event.headers["x-ikhokha-signature"]
    || event.headers["X-iKhokha-Signature"]
    || event.headers["x-ik-signature"]
    || event.headers["X-iK-Signature"]
    || event.headers["x-signature"]
    || event.headers["X-Signature"];
  if (!signature || !process.env.IKHOKHA_API_SECRET) return false;

  const body = event.body || "";
  const hex = createHmac("sha256", process.env.IKHOKHA_API_SECRET).update(body).digest("hex");
  const base64 = createHmac("sha256", process.env.IKHOKHA_API_SECRET).update(body).digest("base64");
  const cleaned = String(signature).replace(/^sha256=/i, "");
  return safeCompare(cleaned, hex) || safeCompare(cleaned, base64);
};

const isVerifiedIkhokhaConfirmation = (event) => verifySignature(event);

const handleConfirmation = async (event) => {
  const body = parseJson(event);
  const order = event.queryStringParameters?.order || body.orderNumber || body.merchantReference || body.reference;
  const status = String(body.status || body.paymentStatus || body.result || "").toLowerCase();
  const paid = ["paid", "success", "successful", "approved", "completed"].includes(status);
  const cancelled = ["cancelled", "canceled", "failed", "failure", "declined", "rejected", "expired"].includes(status);

  if (!order || !isVerifiedIkhokhaConfirmation(event)) {
    return json(202, { ok: true, paid: false });
  }

  if (paid) {
    const updated = await markOrderPaid(order, body);
    return json(200, { ok: true, paid: updated });
  }

  if (cancelled) {
    const updated = await markOrderCancelled(order, body);
    return json(200, { ok: true, paid: false, cancelled: updated });
  }

  return json(202, { ok: true, paid: false });
};

const wantsJson = (event) => {
  const accept = event.headers.accept || event.headers.Accept || "";
  return accept.includes("application/json");
};

export const handler = async (event) => {
  if (event.queryStringParameters?.action === "confirm") {
    return handleConfirmation(event);
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  const missing = ["IKHOKHA_API_KEY", "IKHOKHA_API_SECRET"].filter((key) => !process.env[key]);
  if (missing.length) {
    return json(500, { error: `Missing iKhokha environment variables: ${missing.join(", ")}` });
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
  const deliveryOption = String(body.delivery?.option || body.deliveryOption || "collection").toLowerCase() === "pudo"
    ? "pudo"
    : "collection";
  const delivery = {
    option: deliveryOption,
    label: deliveryOption === "pudo" ? "Pudo Locker Delivery" : "Collect from Lullubelle",
    fee: deliveryOption === "pudo" ? PUDO_DELIVERY_FEE : 0,
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
    const deliveryFee = money(delivery.fee);
    const total = money(subtotal + deliveryFee);
    const submittedTotal = body.finalTotal ?? body.totalAmount ?? body.total;
    if (submittedTotal !== undefined && Math.abs(money(submittedTotal) - total) > 0.01) {
      return json(400, { error: "Order total mismatch. Please refresh your cart and try again." });
    }
    const order = await createPendingOrder({
      customer,
      delivery,
      address,
      notes: customer.notes,
      products,
      subtotal,
      deliveryFee,
      total,
      paymentReference: orderNumber(),
    });
    const testMode = toBoolean(process.env.IKHOKHA_TEST_MODE);
    const checkout = await callIkhokha({ event, order, testMode });

    if (!wantsJson(event)) {
      return {
        statusCode: 303,
        headers: {
          Location: checkout.paymentUrl,
          "Cache-Control": "no-store",
        },
        body: "",
      };
    }

    return json(200, {
      ok: true,
      orderNumber: order.orderNumber,
      paymentUrl: checkout.paymentUrl,
      testMode,
    });
  } catch (error) {
    return json(502, {
      error: error.message || "Unable to start iKhokha checkout.",
      diagnostic: error.diagnostic || {
        step: "Checkout function",
        error: error.message || "Unable to start iKhokha checkout.",
      },
    });
  }
};
