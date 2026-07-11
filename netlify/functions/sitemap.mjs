import { readContent } from "./_admin-shared.mjs";

const SITE_URL = "https://www.lullubelle.co.za";
const PAGE_PATHS = [
  "/",
  "/shop",
  "/book-appointment",
  "/pricelist",
  "/skin-consultations",
  "/beauty-salon-centurion",
  "/advanced-facials-centurion",
  "/microneedling-centurion",
  "/cosmelan-centurion",
  "/waxing-centurion",
  "/massage-centurion",
  "/epilfree-centurion",
  "/skin-care-essentials",
  "/nail-care-kit",
  "/lash-brow-care",
  "/body-care-gift-set",
  "/gift-vouchers",
  "/before-after",
];

const escapeXml = (value) => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

export const handler = async () => {
  const content = await readContent();
  const productPaths = (content.products || [])
    .filter((product) => product?.id && product.hidden !== true)
    .map((product) => `/products/${encodeURIComponent(product.id)}`);
  const urls = [...PAGE_PATHS, ...productPaths];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((path) => `  <url><loc>${escapeXml(`${SITE_URL}${path}`)}</loc></url>`)
    .join("\n")}\n</urlset>`;

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/xml; charset=UTF-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
    body,
  };
};
