import { getStore } from "@netlify/blobs";
import {
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

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

export const defaultContent = () => ({
  products: [],
  treatments: [],
  gallery: [],
  vouchers: [],
  updatedAt: new Date().toISOString(),
});

export const readContent = async () => {
  const stored = await contentStore().get(CONTENT_KEY, { type: "json" });
  return stored || defaultContent();
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
  const stored = await contentStore().get(key, { type: "json" });
  return Array.isArray(stored) ? stored : [];
};

export const writeList = async (key, items) => {
  await contentStore().setJSON(key, Array.isArray(items) ? items : []);
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

  if (parts[0] === "scrypt" && parts.length === 3) {
    const [, salt, expected] = parts;
    const hash = scryptSync(password, salt, 32).toString("hex");
    return safeCompareHex(hash, expected);
  }

  if (parts[0] === "sha256" && parts.length === 2) {
    const hash = createHash("sha256").update(password).digest("hex");
    return safeCompareHex(hash, parts[1]);
  }

  return false;
};

export const newId = (prefix) => `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
