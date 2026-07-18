import {
  BOOKINGS_KEY,
  ORDERS_KEY,
  assetStore,
  clearSessionCookie,
  connectBlobContext,
  createSessionCookie,
  json,
  newId,
  parseJson,
  readContent,
  readList,
  requireSession,
  sessionExpiresAt,
  verifyPassword,
  writeContent,
  writeList,
} from "./_admin-shared.mjs";
import { DISCOUNTS_KEY, sanitiseDiscount, validateDiscountRecord } from "./_discounts.mjs";
import { sanitiseDeliverySettings } from "./_delivery.mjs";
import { validateProductCatalogue, verifyPersistedProducts } from "./_products.mjs";
import { validateServiceCatalogue } from "./_services.mjs";
import { handleReconciliation } from "./ikhokha-checkout.mjs";

const requireAuth = (event) => {
  const session = requireSession(event);
  return session || null;
};

const parseRequestBody = (event) => {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return null;
  }
};

const missingAdminEnv = () => ["ADMIN_USERNAME", "ADMIN_PASSWORD_HASH", "ADMIN_SESSION_SECRET"]
  .filter((name) => !process.env[name]);

const saveUpload = async ({ filename, mimeType, base64, ownerType, ownerId, slot, imageId }) => {
  if (!base64) throw new Error("No image supplied");
  if (!String(mimeType || "").startsWith("image/")) throw new Error("Only image uploads are supported.");
  if (!['product', 'brand'].includes(ownerType) || !/^[a-z0-9][a-z0-9_-]*$/i.test(String(ownerId || ""))) throw new Error("A stable product or brand ID is required for image uploads.");
  if (!['main', 'gallery', 'logo'].includes(slot)) throw new Error("A valid image slot is required.");
  if (slot === 'gallery' && !/^[a-z0-9][a-z0-9_-]*$/i.test(String(imageId || ""))) throw new Error("A stable gallery image ID is required.");
  const encoded = String(base64).replace(/^data:[^,]+,/, "");
  if (encoded.length > 5 * 1024 * 1024) throw new Error("The optimised image is too large. Please upload a smaller image.");
  const extension = (filename || "image.webp").split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "webp";
  const safeImageId = slot === "gallery" ? `-${imageId}` : "";
  const key = `${ownerType}s/${ownerId}/${slot}${safeImageId}-${Date.now()}-${newId("asset")}.${extension}`;
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length) throw new Error("The uploaded image was empty or invalid.");
  try {
    await assetStore().set(key, buffer, {
      metadata: {
        contentType: mimeType || "application/octet-stream",
        originalFilename: filename || key,
      },
    });
  } catch (error) {
    console.error("Admin asset storage failed", { key, message: error?.message });
    const storageError = new Error("Image storage is unavailable. Please try again.");
    storageError.code = "ASSET_STORAGE_UNAVAILABLE";
    throw storageError;
  }
  const persisted = await assetStore().getWithMetadata(key, { type: "arrayBuffer" });
  if (!persisted?.data?.byteLength) throw new Error("Uploaded image could not be verified in storage.");
  return {
    url: `/.netlify/functions/admin-asset?key=${encodeURIComponent(key)}`,
    binding: { ownerType, ownerId, slot, imageId: slot === "gallery" ? imageId : "" },
  };
};

export const handler = async (event) => {
  connectBlobContext(event);
  const method = event.httpMethod;
  const action = event.queryStringParameters?.action || "";

  if (method === "POST" && action === "login") {
    const body = parseRequestBody(event);
    if (!body || typeof body !== "object" || !("username" in body) || !("password" in body)) {
      return json(400, { error: "Invalid request. Send username and password as JSON." });
    }

    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const missing = missingAdminEnv();

    if (missing.length) {
      return json(500, { error: `Missing environment variables: ${missing.join(", ")}` });
    }

    if (username !== process.env.ADMIN_USERNAME || !verifyPassword(password, process.env.ADMIN_PASSWORD_HASH)) {
      return json(401, { error: "Wrong username or password." });
    }

    return json(200, { ok: true, username }, { "Set-Cookie": createSessionCookie(username) });
  }

  const body = parseJson(event);

  if (method === "POST" && action === "logout") {
    return json(200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
  }

  const session = requireAuth(event);
  if (!session && method === "GET" && action === "me") return json(200, { ok: false, authenticated: false });
  if (!session) return json(401, { ok: false, code: "ADMIN_AUTH_REQUIRED", message: "Your admin session has expired. Please sign in again." });

  if (method === "GET" && action === "me") {
    return json(200, {
      ok: true,
      authenticated: true,
      username: session.username,
      expiresAt: sessionExpiresAt(),
    }, { "Set-Cookie": createSessionCookie(session.username) });
  }

  if (method === "POST" && action === "refresh-session") {
    return json(200, {
      ok: true,
      authenticated: true,
      expiresAt: sessionExpiresAt(),
    }, { "Set-Cookie": createSessionCookie(session.username) });
  }

  if (method === "GET" && action === "content") {
    return json(200, await readContent());
  }

  if (method === "PUT" && action === "content") {
    body.deliverySettings = sanitiseDeliverySettings(body.deliverySettings);
    const existingContent = await readContent();
    const validationError = validateProductCatalogue(body, { existingProducts: existingContent.products });
    if (validationError) return json(400, { error: `Validation failed: ${validationError}`, code: "VALIDATION_FAILED" });
    const serviceValidationError = validateServiceCatalogue(body.treatments);
    if (serviceValidationError) return json(400, { error: `Validation failed: ${serviceValidationError}`, code: "VALIDATION_FAILED" });
    try {
      const persisted = await writeContent(body);
      const verificationError = verifyPersistedProducts(body, persisted);
      if (verificationError) return json(500, { error: verificationError, code: "CONTENT_VERIFICATION_FAILED" });
      return json(200, persisted);
    } catch (error) {
      console.error("Admin content storage failed", { message: error?.message });
      return json(500, { error: "Product could not be saved because storage is unavailable. Please try again.", code: "CONTENT_STORAGE_UNAVAILABLE" });
    }
  }

  if (method === "POST" && action === "upload") {
    try {
      const upload = await saveUpload(body);
      return json(200, { ok: true, ...upload });
    } catch (error) {
      const storageFailure = error.code === "ASSET_STORAGE_UNAVAILABLE";
      return json(storageFailure ? 500 : 400, { error: error.message || "Image upload failed.", code: error.code || "IMAGE_UPLOAD_FAILED" });
    }
  }

  if (method === "GET" && action === "bookings") {
    return json(200, await readList(BOOKINGS_KEY));
  }

  if (method === "PUT" && action === "bookings") {
    await writeList(BOOKINGS_KEY, body.items || []);
    return json(200, { ok: true });
  }

  if (method === "GET" && action === "orders") {
    return json(200, await readList(ORDERS_KEY));
  }

  if (method === "POST" && action === "save-order") {
    const incoming = body.order && typeof body.order === "object" ? body.order : null;
    const orderNumber = String(incoming?.orderNumber || "").trim();
    if (!orderNumber) return json(400, { ok: false, code: "ORDER_NUMBER_REQUIRED", message: "An order number is required." });
    const orders = await readList(ORDERS_KEY);
    const index = orders.findIndex((order) => String(order.orderNumber) === orderNumber);
    if (index < 0) return json(404, { ok: false, code: "ORDER_NOT_FOUND", message: `No matching order was found for: ${orderNumber}.` });
    const saved = { ...orders[index], ...incoming, id: orders[index].id, orderNumber: orders[index].orderNumber };
    orders[index] = saved;
    await writeList(ORDERS_KEY, orders);
    return json(200, { ok: true, order: saved });
  }

  if (method === "POST" && ["archive-order", "restore-order", "archive-orders"].includes(action)) {
    const numbers = Array.isArray(body.orderNumbers) ? body.orderNumbers : [body.orderNumber];
    const requested = new Set(numbers.map((value) => String(value || "").trim()).filter(Boolean));
    if (!requested.size) return json(400, { ok: false, code: "ORDER_NUMBER_REQUIRED", message: "At least one order number is required." });
    const orders = await readList(ORDERS_KEY);
    const now = new Date().toISOString();
    const matched = orders.filter((order) => requested.has(String(order.orderNumber)));
    const matchedNumbers = new Set(matched.map((order) => String(order.orderNumber)));
    const missingNumbers = [...requested].filter((orderNumber) => !matchedNumbers.has(orderNumber));
    if (missingNumbers.length) return json(404, { ok: false, code: "ORDER_NOT_FOUND", message: `No matching order was found for: ${missingNumbers.join(", ")}.` });
    const expectedArchived = action !== "restore-order";
    const updated = orders.map((order) => {
      if (!requested.has(String(order.orderNumber))) return order;
      const archivedAt = expectedArchived ? (order.archivedAt || now) : null;
      if (order.archived === expectedArchived && order.archivedAt === archivedAt) return order;
      return { ...order, archived: expectedArchived, archivedAt };
    });
    const changed = updated.filter((order, index) => order !== orders[index]).length;
    if (changed) await writeList(ORDERS_KEY, updated);
    let verifiedOrders = matched;
    if (changed) {
      const delays = [0, 100, 250, 500];
      verifiedOrders = [];
      for (const delay of delays) {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        const readBack = await readList(ORDERS_KEY);
        const foundOrders = [...requested].map((orderNumber) => readBack.find((order) => String(order.orderNumber) === orderNumber));
        const fieldsMatch = foundOrders.every((found) => found && found.archived === expectedArchived && (expectedArchived ? Boolean(found.archivedAt) : found.archivedAt == null));
        if (fieldsMatch) { verifiedOrders = foundOrders; break; }
      }
      if (!verifiedOrders.length) return json(503, { ok: false, code: "ARCHIVE_PERSISTENCE_UNVERIFIED", message: "The archive change could not be verified in storage. Please try again." });
    }
    const archiveStates = verifiedOrders.map((order) => ({ orderNumber: String(order.orderNumber), archived: expectedArchived, archivedAt: expectedArchived ? order.archivedAt : null }));
    if (action === "archive-orders") return json(200, { ok: true, changed, orderNumbers: archiveStates.map((order) => order.orderNumber), archived: expectedArchived, archiveStates });
    return json(200, { ok: true, changed, ...archiveStates[0] });
  }

  if (method === "POST" && action === "reconcile-payment") {
    const orderNumber = String(body.orderNumber || "").trim();
    if (!orderNumber) return json(400, { error: "Order number is required." });
    return handleReconciliation({
      ...event,
      httpMethod: "POST",
      body: JSON.stringify({ orderNumber }),
      queryStringParameters: { action: "reconcile", order: orderNumber },
    }, { trustedAdmin: true });
  }

  if (method === "GET" && action === "discounts") {
    const discounts = await readList(DISCOUNTS_KEY);
    const orders = await readList(ORDERS_KEY);
    return json(200, discounts.map((discount) => ({
      ...discount,
      timesUsed: orders.filter((order) => order.promoCode === discount.code && order.paymentStatus === "Paid").length,
    })));
  }

  if (method === "PUT" && action === "discounts") {
    const current = await readList(DISCOUNTS_KEY);
    const incoming = Array.isArray(body.items) ? body.items : [];
    const next = incoming.map((item) => sanitiseDiscount(item, current.find((existing) => existing.id === item.id)));
    for (const discount of next) {
      const error = validateDiscountRecord(discount, next);
      if (error) return json(400, { error });
    }
    const removed = current.filter((item) => !next.some((candidate) => candidate.id === item.id));
    if (removed.length) {
      const orders = await readList(ORDERS_KEY);
      removed.forEach((item) => {
        if (orders.some((order) => order.promoCode === item.code)) next.push({ ...item, active: false, archived: true, updatedAt: new Date().toISOString() });
      });
    }
    await writeList(DISCOUNTS_KEY, next);
    return json(200, { ok: true, items: next });
  }

  return json(404, { error: "Unknown admin action." });
};
