import { connectBlobContext, contentStore, CONTENT_KEY, json } from "./_admin-shared.mjs";

// Bypass readContent(): its legacy migrations can write. Never create probe records.
export const checkStorage = async (store) => {
  try { await store.get(CONTENT_KEY, { type: "json" }); return true; }
  catch { return false; }
};
export const createStorageHealthHandler = (storeFactory = contentStore) => async (event) => {
  if (event.httpMethod !== "GET") return json(405, { ok: false }, { Allow: "GET" });
  connectBlobContext(event);
  let ok = false;
  try { ok = await checkStorage(storeFactory()); } catch { /* No internal details in public responses. */ }
  return json(ok ? 200 : 503, { ok }, { "X-Robots-Tag": "noindex" });
};

export const handler = createStorageHealthHandler();
