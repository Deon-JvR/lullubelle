import { connectLambda, getStore } from "@netlify/blobs";
import {
  createHmac,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sanitiseDeliverySettings } from "./_delivery.mjs";
import { sanitiseGallery } from "./_gallery.mjs";
import { migrateServiceCatalogue, SERVICE_CATALOGUE_VERSION } from "./_services.mjs";
import {
  CATALOGUE_SCHEMA_VERSION,
  mergeProductCatalogue,
  migrateCatalogueContent,
  normaliseProductGallery,
} from "./_products.mjs";

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

export const connectBlobContext = (event) => {
  if (event?.blobs) connectLambda(event);
};

const isNetlifyRuntime = () => Boolean(process.env.NETLIFY || process.env.CONTEXT || process.env.NETLIFY_BLOBS_CONTEXT);

const getConfiguredStore = (name) => {
  const siteID = process.env.NETLIFY_BLOBS_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) return getStore({ name, siteID, token, consistency: "strong" });
  return getStore({ name, consistency: "strong" });
};

export const contentStore = () => getConfiguredStore("lullubelle-admin");
export const assetStore = () => getConfiguredStore("lullubelle-admin-assets");

const localLists = new Map();

export const defaultContent = () => ({
  catalogueSchemaVersion: CATALOGUE_SCHEMA_VERSION,
  serviceCatalogueVersion: SERVICE_CATALOGUE_VERSION,
  brands: [],
  products: [],
  treatments: [],
  gallery: [],
  vouchers: [],
  deliverySettings: sanitiseDeliverySettings(),
  updatedAt: new Date().toISOString(),
});

const readJsonFile = async (path) => {
  try {
    return JSON.parse(await readFile(join(process.cwd(), path), "utf8"));
  } catch {
    return [];
  }
};

const seedContent = async () => {
  const [brands, products, treatments, gallery, vouchers] = await Promise.all([
    readJsonFile("data/brands.json"),
    readJsonFile("data/products.json"),
    readJsonFile("data/treatments.json"),
    readJsonFile("data/gallery.json"),
    readJsonFile("data/vouchers.json"),
  ]);

  return {
    catalogueSchemaVersion: CATALOGUE_SCHEMA_VERSION,
    serviceCatalogueVersion: SERVICE_CATALOGUE_VERSION,
    brands: Array.isArray(brands) ? brands : [],
    products: Array.isArray(products) ? products : [],
    treatments: Array.isArray(treatments) ? treatments : [],
    gallery: sanitiseGallery(gallery),
    vouchers: Array.isArray(vouchers) ? vouchers : [],
    deliverySettings: sanitiseDeliverySettings(),
    updatedAt: new Date().toISOString(),
  };
};

const hasItems = (value) => Array.isArray(value) && value.length > 0;
const mergeBrands = (seedBrands, storedBrands) => {
  if (!Array.isArray(storedBrands) || !storedBrands.length) return seedBrands;
  return storedBrands;
};
export const readContent = async () => {
  const seed = await seedContent();
  let stored = null;
  try {
    stored = await contentStore().get(CONTENT_KEY, { type: "json" });
  } catch (error) {
    console.error("Admin content read failed; using static fallback", { message: error?.message });
    stored = null;
  }
  if (!stored) return seed;
  const catalogueMigration = migrateCatalogueContent(stored, seed);
  const serviceMigration = migrateServiceCatalogue(catalogueMigration.content, seed);
  if (catalogueMigration.changed || serviceMigration.changed) {
    stored = serviceMigration.content;
    try {
      await contentStore().setJSON(CONTENT_KEY, stored);
    } catch (error) {
      console.error("Admin catalogue migration could not be persisted", { message: error?.message });
    }
  } else stored = serviceMigration.content;
  return {
    ...seed,
    ...stored,
    brands: mergeBrands(seed.brands, stored.brands),
    products: mergeProductCatalogue(seed.products, stored.products),
    treatments: hasItems(stored.treatments) ? stored.treatments : seed.treatments,
    // Once Blob content exists it is authoritative, including an intentionally empty gallery.
    // The static gallery is used only when the content record itself cannot be read.
    gallery: sanitiseGallery(Array.isArray(stored.gallery) ? stored.gallery : []),
    vouchers: hasItems(stored.vouchers) ? stored.vouchers : seed.vouchers,
    deliverySettings: sanitiseDeliverySettings(stored.deliverySettings),
    updatedAt: stored.updatedAt || seed.updatedAt,
  };
};

export const writeContent = async (content) => {
  const next = {
    ...defaultContent(),
    ...content,
    deliverySettings: sanitiseDeliverySettings(content.deliverySettings),
    gallery: sanitiseGallery(content.gallery),
    products: (Array.isArray(content.products) ? content.products : []).map((product) => ({
      ...product,
      galleryImages: normaliseProductGallery(product),
    })),
    updatedAt: new Date().toISOString(),
  };
  await contentStore().setJSON(CONTENT_KEY, next);
  const persisted = await contentStore().get(CONTENT_KEY, { type: "json" });
  if (!persisted || persisted.updatedAt !== next.updatedAt) throw new Error("Saved content could not be verified after writing.");
  return persisted;
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
