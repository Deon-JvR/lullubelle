import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const products = JSON.parse(fs.readFileSync(path.join(root, "data/products.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "data/kalahari-image-manifest.json"), "utf8"));
const failures = [];
const ids = new Set();

for (const product of products) {
  if (!product.id || ids.has(product.id)) failures.push(`duplicate or empty product id: ${product.id}`);
  ids.add(product.id);
  if (!product.imageAlt && product.brand === "Kalahari") failures.push(`empty alt text: ${product.sku}`);
  if (!/^(?:https?:|\/\.netlify\/functions\/admin-asset|public\/images\/products\/|(?:public\/)?products\/)/.test(product.image || "")) failures.push(`invalid image path: ${product.id} ${product.image}`);
  if (!/^(?:https?:|\/\.netlify\/functions\/admin-asset)/.test(product.image || "")) {
    const local = path.join(root, String(product.image).replace(/^\//, ""));
    if (!fs.existsSync(local)) failures.push(`missing local image: ${product.id} ${product.image}`);
  }
  if (product.brand === "Kalahari" && !/^(?:public\/images\/products\/kalahari\/|products\/kalahari(?:-|\/))/.test(product.image)) failures.push(`Kalahari product outside Kalahari path: ${product.sku}`);
  if (product.brand !== "Kalahari" && /\/kalahari\//.test(product.image || "")) failures.push(`incorrect Kalahari default: ${product.id}`);
}
if (manifest.length !== 77) failures.push(`manifest contains ${manifest.length}, expected 77`);
const manifestSkus = new Set();
const verifiedSources = new Map();
for (const entry of manifest) {
  if (manifestSkus.has(entry.sku)) failures.push(`duplicate manifest SKU: ${entry.sku}`);
  manifestSkus.add(entry.sku);
  if (!["verified", "missing", "needs-review"].includes(entry.matchStatus)) failures.push(`invalid status: ${entry.sku}`);
  if (entry.matchStatus === "verified") {
    if (!entry.sourceUrl) failures.push(`verified image lacks source: ${entry.sku}`);
    if (verifiedSources.has(entry.sourceUrl)) failures.push(`verified source duplicated: ${verifiedSources.get(entry.sourceUrl)} and ${entry.sku}`);
    verifiedSources.set(entry.sourceUrl, entry.sku);
    if (/coming-soon|catalogue-product\.svg/.test(entry.localImagePath)) failures.push(`verified SKU uses generic image: ${entry.sku}`);
  } else if (!/product-image-coming-soon\.webp$/.test(entry.localImagePath)) failures.push(`unverified SKU does not use honest placeholder: ${entry.sku}`);
}
const genericKalahari = products.filter((product) => product.brand === "Kalahari" && /catalogue-product\.svg/.test(product.image || ""));
if (genericKalahari.length) failures.push(`${genericKalahari.length} Kalahari products still use catalogue-product.svg`);
if (failures.length) throw new Error(`Product image validation failed:\n- ${failures.join("\n- ")}`);
console.log(`Product image validation passed for ${products.length} records and ${manifest.length} Kalahari manifest entries.`);
