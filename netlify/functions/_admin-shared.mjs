import { getStore } from "@netlify/blobs";
import {
  createHmac,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const SESSION_COOKIE = "lullubelle_admin";
export const SESSION_MAX_AGE = 60 * 30;
export const CONTENT_KEY = "site-content";
export const BOOKINGS_KEY = "bookings";
export const ORDERS_KEY = "orders";

export const json = (statusCode, data, headers = {}) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  },
  body: JSON.stringify(data),
});

export const parseJson = (event) => {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
};

export const contentStore = () => getStore("lullubelle-admin");
export const assetStore = () => getStore("lullubelle-admin-assets");

const localLists = new Map();
const isNetlifyRuntime = () => Boolean(process.env.NETLIFY || process.env.CONTEXT || process.env.NETLIFY_BLOBS_CONTEXT);

export const defaultContent = () => ({
  products: [],
  treatments: [],
  gallery: [],
  vouchers: [],
  updatedAt: new Date().toISOString(),
});

const readJsonFile = async (path) => {
  try {
    return JSON.parse(await readFile(join(process.cwd(), path), "utf8"));
  } catch {
    return [];
  }
};

const normaliseVitaDermProduct = (product) => {
  const slug = product.source_url?.split("/").filter(Boolean).pop() || product.sku?.toLowerCase() || product.name?.toLowerCase()?.replace(/[^a-z0-9]+/g, "-");
  return {
    id: `vitaderm-${slug}`,
    brand: "VitaDerm",
    name: product.name,
    price: Number(product.price) || 0,
    image: `products/vitaderm/${slug}.webp`,
    benefit: (product.benefits || product.description || "Professional VitaDerm skincare available from Lullubelle.").replace(/^Benefits?\s*/i, ""),
    description: (product.description || product.benefits || "Professional VitaDerm skincare available from Lullubelle.").replace(/^Description\s*/i, ""),
    directions: product.directions || "Use as directed by your skin therapist.",
    ingredients: product.ingredients || "Ingredient list not published. Please confirm current ingredients with Lullubelle before purchase.",
    suitable: Array.isArray(product.categories) && product.categories.length ? product.categories.join(", ") : "Selected skin routines after consultation.",
    size: product.size || "",
    sku: product.sku || "",
    stockStatus: "In stock",
    featured: product.manual_review !== true && Number(product.price) > 0,
    hidden: false,
  };
};

const seedContent = async () => {
  const [products, vitaDerm, treatments, gallery, vouchers] = await Promise.all([
    readJsonFile("data/products.json"),
    readJsonFile("products/vitaderm/catalogue.json"),
    readJsonFile("data/treatments.json"),
    readJsonFile("data/gallery.json"),
    readJsonFile("data/vouchers.json"),
  ]);

  const vitaDermProducts = Array.isArray(vitaDerm) ? vitaDerm.map(normaliseVitaDermProduct) : [];
  const productIds = new Set();
  const mergedProducts = [...products, ...vitaDermProducts].filter((product) => {
    if (!product?.id || productIds.has(product.id)) return false;
    productIds.add(product.id);
    return true;
  });

  return {
    products: mergedProducts,
    treatments: Array.isArray(treatments) ? treatments : [],
    gallery: Array.isArray(gallery) ? gallery : [],
    vouchers: Array.isArray(vouchers) ? vouchers : [],
    updatedAt: new Date().toISOString(),
  };
};

const hasAnyContent = (content) => ["products", "treatments", "gallery", "vouchers"]
  .some((key) => Array.isArray(content?.[key]) && content[key].length > 0);

export const readContent = async () => {
  const seed = await seedContent();
  let stored = null;
  try {
    stored = await contentStore().get(CONTENT_KEY, { type: "json" });
  } catch (error) {
    if (isNetlifyRuntime()) throw error;
    stored = null;
  }
  if (!stored || !hasAnyContent(stored)) return seed;
  return {
    ...seed,
    ...stored,
    products: Array.isArray(stored.products) ? stored.products : seed.products,
    treatments: Array.isArray(stored.treatments) ? stored.treatments : seed.treatments,
    gallery: Array.isArray(stored.gallery) ? stored.gallery : seed.gallery,
    vouchers: Array.isArray(stored.vouchers) ? stored.vouchers : seed.vouchers,
    updatedAt: stored.updatedAt || seed.updatedAt,
  };
};

export const writeContent = async (content) => {
  const next = {
    ...defaultContent(),
    ...content,
    updatedAt: new Date().toISOString(),
  };
  await contentStore().setJSON(CONTENT_KEY, next);
  return next;
};

export const readList = async (key) => {
  let stored = null;
  try {
    stored = await contentStore().get(key, { type: "json" });
  } catch (error) {
    if (isNetlifyRuntime()) throw error;
    stored = localLists.get(key) || [];
  }
  return Array.isArray(stored) ? stored : [];
};

export const writeList = async (key, items) => {
  const next = Array.isArray(items) ? items : [];
  try {
    await contentStore().setJSON(key, next);
  } catch (error) {
    if (isNetlifyRuntime()) throw error;
    localLists.set(key, next);
  }
};

const base64Url = (input) => Buffer.from(input).toString("base64url");

const sign = (payload) => createHmac("sha256", process.env.ADMIN_SESSION_SECRET || "")
  .update(payload)
  .digest("base64url");

export const createSessionCookie = (username) => {
  const payload = base64Url(JSON.stringify({
    username,
    exp: Date.now() + SESSION_MAX_AGE * 1000,
    nonce: randomBytes(12).toString("hex"),
  }));
  const value = `${payload}.${sign(payload)}`;
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
};

export const clearSessionCookie = () => `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

export const getCookie = (event, name) => {
  const cookie = event.headers.cookie || event.headers.Cookie || "";
  return cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1);
};

export const requireSession = (event) => {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 24) return null;

  const value = getCookie(event, SESSION_COOKIE);
  if (!value || !value.includes(".")) return null;

  const [payload, signature] = value.split(".");
  const expected = sign(payload);
  const provided = Buffer.from(signature || "");
  const wanted = Buffer.from(expected);
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session.exp || session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
};

const safeCompareHex = (a, b) => {
  const left = Buffer.from(a || "", "hex");
  const right = Buffer.from(b || "", "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
};

export const verifyPassword = (password, storedHash) => {
  if (!password || !storedHash) return false;
  const parts = storedHash.split("$");

  if (parts[0] === "pbkdf2" && parts.length === 5) {
    const [, digest, iterations, salt, expected] = parts;
    const hash = pbkdf2Sync(password, salt, Number(iterations), 32, digest).toString("hex");
    return safeCompareHex(hash, expected);
  }

  return false;
};

export const newId = (prefix) => `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
