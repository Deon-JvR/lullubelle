import { assetStore, connectBlobContext } from "./_admin-shared.mjs";

export const handler = async (event) => {
  connectBlobContext(event);
  const key = event.queryStringParameters?.key || "";
  if (!key) return { statusCode: 404, body: "Not found" };

  let blob;
  try {
    blob = await assetStore().getWithMetadata(key, { type: "arrayBuffer" });
  } catch (error) {
    console.error("Admin asset read failed", { key, message: error?.message });
    return {
      statusCode: 503,
      headers: { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" },
      body: JSON.stringify({ error: "Image storage is unavailable.", code: "ASSET_STORAGE_UNAVAILABLE" }),
    };
  }
  if (!blob?.data) return { statusCode: 404, body: "Not found" };

  const contentType = blob.metadata?.contentType || "application/octet-stream";
  return {
    statusCode: 200,
    isBase64Encoded: true,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
    body: Buffer.from(blob.data).toString("base64"),
  };
};
