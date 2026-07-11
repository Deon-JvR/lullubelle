import {
  BOOKINGS_KEY,
  ORDERS_KEY,
  assetStore,
  clearSessionCookie,
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

const REQUIRED_PRODUCT_BRANDS = ["Kalahari", "VitaDerm", "Mesoestetic"];
const SUPPORTED_PRODUCT_BRANDS = [...REQUIRED_PRODUCT_BRANDS, "SunSkin", "Soopa"];

const validateProductCatalogue = (content) => {
  const products = Array.isArray(content?.products) ? content.products : [];
  if (products.length < 65) {
    return "The product catalogue must contain all 65 products before saving.";
  }

  const brands = new Set(products.map((product) => product?.brand).filter(Boolean));
  const missingBrands = REQUIRED_PRODUCT_BRANDS.filter((brand) => !brands.has(brand));
  if (missingBrands.length) {
    return `The product catalogue is missing required brand(s): ${missingBrands.join(", ")}.`;
  }

  const unsupportedProduct = products.find((product) => !SUPPORTED_PRODUCT_BRANDS.includes(product?.brand));
  if (unsupportedProduct) {
    return `Unsupported product brand: ${unsupportedProduct.brand || "Missing brand"}.`;
  }

  const invalidProduct = products.find((product) => {
    const price = Number(product?.price);
    return !product?.name?.trim()
      || !product?.brand?.trim()
      || !product?.image?.trim()
      || !Number.isFinite(price)
      || price <= 0;
  });
  if (invalidProduct) {
    return `Product name, brand, image and a valid price are required for every product. Please review: ${invalidProduct.name || invalidProduct.id || "Unnamed product"}.`;
  }

  return "";
};

const saveUpload = async ({ filename, mimeType, base64 }) => {
  if (!base64) throw new Error("No image supplied");
  const extension = (filename || "image.webp").split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "webp";
  const key = `${Date.now()}-${newId("asset")}.${extension}`;
  const buffer = Buffer.from(base64.replace(/^data:[^,]+,/, ""), "base64");
  await assetStore().set(key, buffer, {
    metadata: {
      contentType: mimeType || "application/octet-stream",
      originalFilename: filename || key,
    },
  });
  return `/.netlify/functions/admin-asset?key=${encodeURIComponent(key)}`;
};

export const handler = async (event) => {
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
    const validationError = validateProductCatalogue(body);
    if (validationError) return json(400, { error: validationError });
    return json(200, await writeContent(body));
  }

  if (method === "POST" && action === "upload") {
    try {
      const url = await saveUpload(body);
      return json(200, { ok: true, url });
    } catch (error) {
      return json(400, { error: error.message || "Upload failed." });
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

  return json(404, { error: "Unknown admin action." });
};
