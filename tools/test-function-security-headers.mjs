import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { handler as adminContentHandler } from "../netlify/functions/admin-content.mjs";
import { handler as productPageHandler } from "../netlify/functions/product-page.mjs";
import { handler as sitemapHandler } from "../netlify/functions/sitemap.mjs";
import { apiSecurityHeaders, htmlSecurityHeaders, xmlSecurityHeaders } from "../netlify/functions/lib/security-headers.mjs";

const products = JSON.parse(await readFile(new URL("../data/products.json", import.meta.url), "utf8"));
const canonicalHost = "https://www.lullubelle.co.za";
const representatives = [
  "kalahari-skincare-journey-kit-in-travel-bag",
  "vitaderm-gentle-eye-make-up-remover",
  "mesoestetic-hydra-vital-light",
];

const assertHsts = (value) => {
  assert.ok(value, "missing Strict-Transport-Security");
  const directives = new Map();
  for (const part of value.split(";").map((item) => item.trim()).filter(Boolean)) {
    const [name, ...valueParts] = part.split("=");
    const normalisedName = name.toLowerCase();
    assert.ok(!directives.has(normalisedName), `duplicate HSTS directive ${name}`);
    directives.set(normalisedName, valueParts.join("=").trim());
  }
  assert.equal(directives.get("max-age"), "31536000");
  assert.ok(directives.has("includesubdomains"), "HSTS must include includeSubDomains");
  const allowed = new Set(["max-age", "includesubdomains", "preload"]);
  directives.forEach((_value, name) => assert.ok(allowed.has(name), `unexpected HSTS directive ${name}`));
};

const assertHeaders = (actual, expected) => {
  const names = Object.keys(actual).map((name) => name.toLowerCase());
  assert.equal(new Set(names).size, names.length, "response must not contain case-insensitive duplicate headers");
  Object.entries(expected).forEach(([name, value]) => {
    const actualName = Object.keys(actual).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    assert.ok(actualName, `missing ${name}`);
    if (name.toLowerCase() === "strict-transport-security") assertHsts(actual[actualName]);
    else assert.equal(actual[actualName], value, `${name} must match the shared policy`);
  });
};

assertHsts("max-age=31536000; includeSubDomains");
assertHsts("MAX-AGE=31536000; INCLUDESUBDOMAINS; PRELOAD");
assert.throws(() => assertHsts("max-age=86400; includeSubDomains"));
assert.throws(() => assertHsts("max-age=31536000; includeSubDomains; unexpected"));
assert.throws(() => assertHsts("max-age=31536000; max-age=86400; includeSubDomains"));

for (const slug of representatives) {
  const product = products.find((item) => (item.slug || item.id) === slug);
  assert.ok(product, `missing representative product ${slug}`);
  const response = await productPageHandler({ path: `/products/${slug}` });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["Content-Type"], /^text\/html;/i);
  assert.equal(response.headers["Cache-Control"], "public, max-age=0, must-revalidate");
  assertHeaders(response.headers, htmlSecurityHeaders);
  assert.match(response.body, new RegExp(`<title>[^<]*${product.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^<]*</title>`, "i"));
  assert.match(response.body, new RegExp(`<link\\s+rel="canonical"\\s+href="${canonicalHost}/products/${slug}">`, "i"));
  assert.match(response.body, /<meta\s+property="og:title"\s+content="[^"]+"/i);
  assert.match(response.body, /<meta\s+property="og:description"\s+content="[^"]+"/i);
  assert.match(response.body, /<meta\s+property="og:type"\s+content="product"/i);
  assert.match(response.body, new RegExp(`<meta\\s+property="og:url"\\s+content="${canonicalHost}/products/${slug}"`, "i"));
  assert.match(response.body, /<meta\s+property="og:image"\s+content="https:\/\/[^"]+"/i);
  assert.match(response.body, /<meta\s+name="twitter:card"\s+content="summary_large_image"/i);
  assert.match(response.body, /<meta\s+name="twitter:title"\s+content="[^"]+"/i);
  assert.match(response.body, /<meta\s+name="twitter:description"\s+content="[^"]+"/i);
  assert.match(response.body, /<meta\s+name="twitter:image"\s+content="https:\/\/[^"]+"/i);
}

const sitemapResponse = await sitemapHandler({});
assert.equal(sitemapResponse.statusCode, 200);
assert.equal(sitemapResponse.headers["Content-Type"], "application/xml; charset=UTF-8");
assertHeaders(sitemapResponse.headers, xmlSecurityHeaders);
const generatedUrls = [...sitemapResponse.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const activeProducts = products.filter((product) => (product?.slug || product?.id) && product.hidden !== true && product.active !== false && product.published !== false);
assert.equal(generatedUrls.length, 25 + activeProducts.length);
assert.equal(new Set(generatedUrls).size, generatedUrls.length);
assert.ok(generatedUrls.includes(`${canonicalHost}/before-after/`));
assert.ok(!generatedUrls.includes(`${canonicalHost}/before-after`));
assert.ok(!generatedUrls.some((url) => /admin|payment|callback|success|cancel/i.test(new URL(url).pathname)));
assert.ok(!generatedUrls.some((url) => /epilfree-hair-removal-centurion/i.test(url)));
activeProducts.forEach((product) => assert.ok(generatedUrls.includes(`${canonicalHost}/products/${encodeURIComponent(product.slug || product.id)}`)));

const staticSitemap = await readFile(new URL("../sitemap.xml", import.meta.url), "utf8");
const staticUrls = [...staticSitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
assert.equal(staticUrls.length, 25);
assert.equal(new Set(staticUrls).size, staticUrls.length);
assert.ok(staticUrls.includes(`${canonicalHost}/before-after/`));
assert.ok(!staticUrls.includes(`${canonicalHost}/before-after`));
assert.ok(!staticUrls.some((url) => /epilfree-hair-removal-centurion/i.test(url)));

const apiResponse = await adminContentHandler({});
assert.equal(apiResponse.statusCode, 200);
assert.match(apiResponse.headers["Content-Type"], /^application\/json;/i);
assertHeaders(apiResponse.headers, apiSecurityHeaders);
assert.equal(apiResponse.headers["Content-Security-Policy"], undefined);
assert.doesNotThrow(() => JSON.parse(apiResponse.body));

console.log("Function security headers, raw product metadata and sitemap regression tests passed.");
