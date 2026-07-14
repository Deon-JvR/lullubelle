import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const reportPath = process.argv[2] || "/tmp/kalahari-image-downloader-run/kalahari-image-downloader/kalahari-image-download-report.json";
const downloadedDir = path.join(path.dirname(reportPath), "public/images/products/kalahari");
const outputDir = path.join(root, "public/images/products/kalahari");
const productsPath = path.join(root, "data/products.json");
const manifestPath = path.join(root, "data/kalahari-image-manifest.json");
const placeholder = "public/images/products/kalahari/product-image-coming-soon.webp";
const manualReviewSkus = new Set(["PHY07", "DD04", "PFF01"]);
const manuallyMissingSkus = new Set(["DD04", "PFF01", "PRM20"]);
const manuallyVerifiedSkus = new Set(["FK2090", "FK1010", "PHY07", "PHY06", "FK1013", "AP03"]);
const manualAssets = new Map(Object.entries({
  DC001: "https://kalaharilifestyle.com/wp-content/uploads/2019/09/eco-disposable-compress-towel-1.jpg",
  GAU01: "http://chrisalley.co.za/cdn/shop/products/kalahari-gauze-non-sterile-100-individual-units-3634320.jpg?v=1759566250",
  D24: "https://mc10317beautyproducts.blob.core.windows.net/mc10317no-beautyproducts-public/mc10317nobeautyproducts/45187/image/4ff7f51e-8f1a-4d91-b9ce-7583f1eeec94/p_ka2164_default_1.w900.png",
  FK1175: "https://www.cosmetology.co.za/wp-content/uploads/2021/09/NEW-Soothing-Lips-Buchu-Kisses.png",
  PM022: "http://www.kalm-studio.co.za/cdn/shop/files/LipPopWildHoney_53ebceb5-3714-4185-a263-711f323158fb.jpg?v=1720734508",
  D008A: "https://kalaharilifestyle.com/wp-content/uploads/2019/03/skincare-journey-kit-1.jpg",
  VIT01: "https://kalaharilifestyle.com/wp-content/uploads/2021/05/Vitamin-c-Sheet-Mask.jpg",
  PH010: "https://kalaharilifestyle.com/wp-content/uploads/2019/02/Phyto-salve-1.jpg",
  FK1170: "https://kalaharilifestyle.com/wp-content/uploads/2019/03/Soothing-lips-wild-honey.jpg",
  FK1007: "https://kalaharilifestyle.com/wp-content/uploads/2023/05/Lip-Balm-brown.jpg",
  FK1200: "https://kalaharilifestyle.com/wp-content/uploads/2019/03/Desert-Rose-Set.png",
  FK1201: "https://kalaharilifestyle.com/wp-content/uploads/2019/03/Kalahari-Sunset-Set.png",
}));
const sensitivePattern = /\b(?:ivory|marble|sun kissed|alabaster|honey|savannah|lip|kit|pouch|refill)\b/i;

const products = JSON.parse(await fs.readFile(productsPath, "utf8"));
const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
const bySku = new Map(report.map((item) => [item.sku, item]));
const kalahari = products.filter((product) => product.brand === "Kalahari");
if (kalahari.length !== 77) throw new Error(`Expected 77 Kalahari records, found ${kalahari.length}`);
await fs.mkdir(outputDir, { recursive: true });

const normalise = (value) => String(value || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").replace(/\b(?:ph|spf|ml|g|tube|set|in|with|and|the)\b/g, " ").replace(/\s+/g, " ").trim();
const manifest = [];
for (const product of kalahari) {
  const candidate = bySku.get(product.sku);
  const manualSource = manualAssets.get(product.sku);
  const exactTitle = candidate?.matchedProduct && (normalise(candidate.matchedProduct) === normalise(product.name)
    || normalise(candidate.matchedProduct).startsWith(`${normalise(product.name)} `));
  const sensitive = sensitivePattern.test(`${product.name} ${product.category}`);
  const verified = Boolean(manualSource) || (candidate?.status === "downloaded" && (manuallyVerifiedSkus.has(product.sku)
    || (exactTitle && !manualReviewSkus.has(product.sku) && (!sensitive || candidate.score >= 0.9))));
  const matchStatus = verified ? "verified" : (candidate?.status === "missing" || manuallyMissingSkus.has(product.sku)) ? "missing" : "needs-review";
  const localImagePath = verified ? `public/images/products/kalahari/${product.sku.toLowerCase()}.webp` : placeholder;
  if (verified && !manualSource) await fs.copyFile(path.join(downloadedDir, candidate.filename), path.join(root, localImagePath));
  product.image = localImagePath;
  product.imageAlt = verified ? `Kalahari ${product.name} ${product.size || "product"}` : `Kalahari ${product.name} — product image coming soon`;
  manifest.push({
    sku: product.sku,
    productName: product.name,
    brand: product.brand,
    expectedVariant: [product.size, product.description].filter(Boolean).join(" — "),
    localImagePath,
    sourceUrl: verified ? (manualSource || candidate?.imageUrl || "") : "",
    matchStatus,
    verificationNotes: verified
      ? `${manualSource || manuallyVerifiedSkus.has(product.sku) ? "Manual packaging review approved" : "Exact normalized supplier title"}: ${manualSource ? product.name : candidate.matchedProduct}; SKU-specific WebP copied after title and variant guard.`
      : candidate?.status === "missing" || manuallyMissingSkus.has(product.sku)
        ? `No reliable exact-SKU image found after checking the official catalogue, official product search, supplied catalogue assets and authorized stockist results. Neutral coming-soon image required. Best rejected match: ${candidate?.bestMatch || candidate?.matchedProduct || "none"}.`
        : `Automatic candidate rejected pending manual visual confirmation: ${candidate?.matchedProduct || "none"} (${candidate?.score ?? 0}).`,
  });
}

const verifiedSources = new Map();
for (const item of manifest.filter((entry) => entry.matchStatus === "verified")) {
  if (!item.sourceUrl) throw new Error(`Verified SKU ${item.sku} lacks source URL`);
  if (verifiedSources.has(item.sourceUrl)) throw new Error(`Distinct verified SKUs ${verifiedSources.get(item.sourceUrl)} and ${item.sku} share one source image`);
  verifiedSources.set(item.sourceUrl, item.sku);
}
await fs.writeFile(productsPath, `${JSON.stringify(products, null, 2)}\n`);
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(Object.groupBy(manifest, (item) => item.matchStatus), null, 2));
