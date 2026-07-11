import { randomBytes } from "node:crypto";
import { assetStore, contentStore, json } from "./_admin-shared.mjs";

const probeStore = async (name, createStore) => {
  const key = `health/${Date.now()}-${randomBytes(6).toString("hex")}`;
  const value = `lullubelle-storage-health:${key}`;
  let store;

  try {
    store = createStore();
    await store.set(key, value);
    const stored = await store.get(key, { type: "text" });
    if (stored !== value) throw new Error("Blob read did not match the probe value.");
    return { name, ok: true };
  } catch (error) {
    console.error("Blob storage health check failed", { store: name, message: error?.message });
    return { name, ok: false, error: error?.message || "Blob operation failed." };
  } finally {
    try {
      await store?.delete(key);
    } catch (error) {
      console.error("Blob storage health cleanup failed", { store: name, message: error?.message });
    }
  }
};

export const handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return json(405, { ok: false, error: "Method not allowed." }, { Allow: "GET" });
  }

  const checks = await Promise.all([
    probeStore("content", contentStore),
    probeStore("assets", assetStore),
  ]);
  const ok = checks.every((check) => check.ok);

  return json(ok ? 200 : 503, {
    ok,
    service: "netlify-blobs",
    checks,
    checkedAt: new Date().toISOString(),
  });
};
