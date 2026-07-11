import { randomBytes } from "node:crypto";
import { assetStore, connectBlobContext, contentStore, json } from "./_admin-shared.mjs";

const runtimeSummary = () => {
  const encoded = process.env.NETLIFY_BLOBS_CONTEXT;
  if (!encoded) return { contextPresent: false };

  try {
    const context = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    return {
      contextPresent: true,
      fields: Object.keys(context).filter((key) => key !== "token").sort(),
      tokenPresent: Boolean(context.token),
      siteMatches: !process.env.SITE_ID || context.siteID === process.env.SITE_ID,
      deployMatches: !process.env.DEPLOY_ID || context.deployID === process.env.DEPLOY_ID,
      edgeHost: context.edgeURL ? new URL(context.edgeURL).hostname : null,
    };
  } catch {
    return { contextPresent: true, contextValid: false };
  }
};

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
  connectBlobContext(event);
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
    runtime: runtimeSummary(),
    checkedAt: new Date().toISOString(),
  });
};
