import { assetStore, connectBlobContext } from "./_admin-shared.mjs";
import { apiSecurityHeaders, mergeSecurityHeaders } from "./lib/security-headers.mjs";

const response = (statusCode, body, headers = {}, isBase64Encoded = false) => ({
  statusCode,
  ...(isBase64Encoded ? { isBase64Encoded: true } : {}),
  headers: mergeSecurityHeaders(headers, apiSecurityHeaders),
  body,
});

export const handler = async (event) => {
  connectBlobContext(event);
  const key = event.queryStringParameters?.key || "";
  if (!key) return response(404, "Not found");

  let blob;
  try {
    blob = await assetStore().getWithMetadata(key, { type: "arrayBuffer" });
  } catch (error) {
    console.error("Admin asset read failed", { key, message: error?.message });
    return response(503, JSON.stringify({ error: "Image storage is unavailable.", code: "ASSET_STORAGE_UNAVAILABLE" }), { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" });
  }
  if (!blob?.data) return response(404, "Not found");

  const contentType = blob.metadata?.contentType || "application/octet-stream";
  return response(200, Buffer.from(blob.data).toString("base64"), {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
  }, true);
};
