import { assetStore } from "./_admin-shared.mjs";

export const handler = async (event) => {
  const key = event.queryStringParameters?.key || "";
  if (!key) return { statusCode: 404, body: "Not found" };

  const blob = await assetStore().getWithMetadata(key, { type: "arrayBuffer" });
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
