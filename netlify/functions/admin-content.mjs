import { publicContent } from "./_public-catalogue.mjs";
import { connectBlobContext, json, readContent } from "./_admin-shared.mjs";

export const handler = async (event) => {
  connectBlobContext(event);
  let content;
  try { content = await readContent(); } catch { return json(503,{error:"Catalogue temporarily unavailable."},{"Retry-After":"60"}); }
  return json(200, publicContent(content), {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Netlify-CDN-Cache-Control": "no-store",
    Pragma: "no-cache",
  });
};
