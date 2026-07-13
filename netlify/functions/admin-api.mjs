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
  verifyPassword,
  writeContent,
  writeList,
} from "./_admin-shared.mjs";
import { DISCOUNTS_KEY, sanitiseDiscount, validateDiscountRecord } from "./_discounts.mjs";
import { sanitiseDeliverySettings } from "./_delivery.mjs";
import { validateProductCatalogue, verifyPersistedProducts } from "./_products.mjs";

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
  const persisted = await assetStore().getWithMetadata(key, { type: "arrayBuffer", consistency: "strong" });
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
  if (!session) return json(401, { error: "Admin login required." });

  if (method === "GET" && action === "me") {
    return json(200, { ok: true, username: session.username });
  }

  if (method === "GET" && action === "content") {
    return json(200, await readContent());
  }

  if (method === "PUT" && action === "content") {
    body.deliverySettings = sanitiseDeliverySettings(body.deliverySettings);
    const validationError = validateProductCatalogue(body);
    if (validationError) return json(400, { error: `Validation failed: ${validationError}`, code: "VALIDATION_FAILED" });
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

  if (method === "PUT" && action === "orders") {
    await writeList(ORDERS_KEY, body.items || []);
    return json(200, { ok: true });
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
