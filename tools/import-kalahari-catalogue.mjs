import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const pdfPath = resolve(root, valueAfter("--pdf", "Docs/Cataloques/Kalahari/kalahari 2025.pdf"));
const productsPath = resolve(root, valueAfter("--products", "data/products.json"));
const reportPath = resolve(root, valueAfter("--report", "reports/kalahari-2025-import.json"));
const genericImage = "public/images/products/kalahari/product-image-coming-soon.webp";

const identity = (value) => String(value || "").trim().toLowerCase();
const slugify = (value) => String(value || "")
  .toLowerCase()
  .replace(/&/g, "and")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");
const collapse = (value) => String(value || "").replace(/\s+/g, " ").trim();

const categoryNames = new Map([
  ["skincare kits", "Treatment"],
  ["prepare", "Prepare"],
  ["cleaning tools & disposables", "Prepare"],
  ["treatment masks", "Treatment Masks"],
  ["treatments eye care", "Treatment"],
  ["correctors", "Correcting Gels"],
  ["correctors | gels & lotion | apply underneath moisturisers", "Correcting Gels"],
  ["support serums & face oil | apply underneath moisturisers", "Serums and Face Oil"],
  ["treatment moisturisers", "Treatment Moisturisers"],
  ["de-age complex treatments", "Anti-Aging"],
  ["glassglow treatment products", "Anti-Aging"],
  ["effective uva/uvb protection", "UVA/UVB Protection"],
  ["tinted treatment moisturisers & phyto fluid foundation", "Tinted SPF"],
  ["treatment lip care", "Treatment Lip Care"],
]);

const readCatalogue = async () => {
  const data = new Uint8Array(await readFile(pdfPath));
  const document = await getDocument({ data, useSystemFonts: true }).promise;
  const products = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const text = await page.getTextContent();
    const items = text.items
      .filter((item) => collapse(item.str))
      .map((item) => ({
        text: collapse(item.str),
        x: Number(item.transform[4]),
        y: Number(item.transform[5]),
        font: item.fontName,
      }));
    const skuItems = items.filter((item) => item.x < 60 && /^[A-Z][A-Z0-9]*$/.test(item.text));
    const productFont = skuItems[0]?.font;
    const headings = items
      .filter((item) => item.x < 25 && item.font !== productFont)
      .map((item) => ({ y: item.y, text: identity(item.text).replace(/│/g, "|") }))
      .filter((item) => categoryNames.has(item.text));

    for (const skuItem of skuItems) {
      const row = items.filter((item) => Math.abs(item.y - skuItem.y) < 1.1).sort((a, b) => a.x - b.x);
      const category = headings.filter((heading) => heading.y > skuItem.y).sort((a, b) => a.y - b.y)[0];
      const size = collapse(row.filter((item) => item.x >= 60 && item.x < 105).map((item) => item.text).join(" "));
      const name = collapse(row.filter((item) => item.x >= 105 && item.x < 260).map((item) => item.text).join(" "));
      const description = collapse(row.filter((item) => item.x >= 260 && item.x < 500).map((item) => item.text).join(" "));
      const priceText = row.find((item) => item.x >= 500 && /^R[\d,]+\.\d{2}$/.test(item.text))?.text || "";
      if (!category || !size || !name || !description || !priceText) {
        throw new Error(`Could not parse catalogue row ${skuItem.text} on page ${pageNumber}.`);
      }
      products.push({
        sku: skuItem.text,
        size,
        name,
        description,
        price: Number(priceText.replace(/[^\d.]/g, "")),
        category: categoryNames.get(category.text),
        cataloguePage: pageNumber,
      });
    }
  }
  return products.map((product, index) => ({ ...product, catalogueOrder: index + 1 }));
};

const fileExists = async (path) => {
  try { await access(path); return true; } catch { return false; }
};

const resolveProductImage = async (id, name) => {
  const slugs = [id, `kalahari-${slugify(name)}`, `kalahari-${slugify(name).replace(/-tube$/, "")}`];
  for (const slug of [...new Set(slugs)]) {
    const path = `products/${slug}.webp`;
    if (await fileExists(resolve(root, path))) return path;
  }
  return genericImage;
};

const keywordsFor = (product) => {
  const phrases = [
    "Kalahari",
    product.sku,
    product.name,
    product.category,
    product.size,
    ...product.description.split(/[^A-Za-z0-9+/-]+/).filter((word) => word.length >= 4),
  ];
  const seen = new Set();
  return phrases.filter((phrase) => {
    const key = identity(phrase);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(", ");
};

const duplicateValues = (items, key) => {
  const values = items.map((item) => identity(item[key])).filter(Boolean);
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
};

const catalogue = await readCatalogue();
const currentProducts = JSON.parse(await readFile(productsPath, "utf8"));
const catalogueDuplicateSkus = duplicateValues(catalogue, "sku");
if (catalogueDuplicateSkus.length) throw new Error(`Duplicate catalogue SKUs: ${catalogueDuplicateSkus.join(", ")}`);

const existingDuplicateSkus = duplicateValues(currentProducts, "sku");
const usedExisting = new Set();
const updated = [];
const created = [];
const imported = [];
const ids = new Set(currentProducts.map((product) => identity(product.id)));

for (const source of catalogue) {
  const skuMatches = currentProducts.filter((product) => identity(product.sku) === identity(source.sku) && !usedExisting.has(product));
  if (skuMatches.length > 1) throw new Error(`Multiple existing products use SKU ${source.sku}.`);
  const nameMatches = skuMatches.length ? [] : currentProducts.filter((product) => product.name === source.name && !usedExisting.has(product));
  if (nameMatches.length > 1) throw new Error(`Multiple existing products use the exact name ${source.name}.`);
  const existing = skuMatches[0] || nameMatches[0];
  if (existing) usedExisting.add(existing);

  let id = existing?.id || `kalahari-${slugify(source.name)}`;
  if (!existing && ids.has(identity(id))) id = `${id}-${identity(source.sku)}`;
  ids.add(identity(id));
  const image = existing?.image || await resolveProductImage(id, source.name);
  const next = {
    ...(existing || {}),
    id,
    slug: id,
    sku: source.sku,
    brandId: "kalahari",
    brand: "Kalahari",
    categories: existing?.categories?.length ? existing.categories : [source.category],
    name: source.name,
    size: source.size,
    description: source.description,
    benefit: source.description,
    price: source.price,
    searchKeywords: existing?.searchKeywords || keywordsFor(source),
    image,
    imageAlt: existing?.imageAlt || (image === genericImage
      ? `Kalahari ${source.name} — product image coming soon`
      : `Kalahari ${source.name}`),
    directions: existing?.directions || "Use as directed on the product packaging or by your skin therapist.",
    ingredients: existing?.ingredients || "Please confirm the current ingredient list with Lullubelle before purchase.",
    suitable: existing?.suitable || source.description,
    stockStatus: "In stock",
    active: true,
    published: true,
    status: "active",
    hidden: false,
    catalogueSource: "Kalahari Retail Price List 2025",
    catalogueTotal: catalogue.length,
    cataloguePage: source.cataloguePage,
    catalogueOrder: source.catalogueOrder,
    seoTitle: `Kalahari ${source.name} ${source.size} | Lullubelle`,
    seoDescription: `Shop Kalahari ${source.name} ${source.size} for R${source.price} from Lullubelle Beauty Specialist in Centurion.`,
  };
  imported.push(next);
  (existing ? updated : created).push({ sku: source.sku, name: source.name, id, matchedBy: skuMatches.length ? "SKU" : existing ? "exact name" : "new" });
}

const retained = currentProducts.filter((product) => identity(product.brand) !== "kalahari" && identity(product.brandId) !== "kalahari");
const obsoleteProductsRemoved = currentProducts
  .filter((product) => (identity(product.brand) === "kalahari" || identity(product.brandId) === "kalahari") && !usedExisting.has(product))
  .map(({ id, sku = "", name }) => ({ id, sku, name, reason: "Not present in authoritative catalogue and did not match by SKU or exact name" }));
const nextProducts = [...retained, ...imported];

const report = {
  source: pdfPath.replace(`${root}/`, ""),
  cataloguePages: 2,
  catalogueProducts: catalogue.length,
  existingProductsUpdated: updated.length,
  newProductsCreated: created.length,
  skippedProducts: [],
  duplicateCatalogueSkus: catalogueDuplicateSkus,
  duplicateExistingSkus: existingDuplicateSkus,
  obsoleteProductsRemoved,
  finalKalahariProducts: imported.length,
  finalTotalProducts: nextProducts.length,
  updated,
  created,
};

if (catalogue.length !== 77) throw new Error(`Expected 77 catalogue products, parsed ${catalogue.length}.`);
if (imported.some((product) => product.brand !== "Kalahari" || product.brandId !== "kalahari" || product.active !== true || product.hidden !== false)) {
  throw new Error("Every imported product must be active and assigned to Kalahari.");
}

if (checkOnly) {
  const currentKalahari = currentProducts.filter((product) => identity(product.brand) === "kalahari" || identity(product.brandId) === "kalahari");
  if (JSON.stringify(currentKalahari) !== JSON.stringify(imported)) throw new Error("The committed Kalahari products do not match the PDF import result.");
  const required = ["id", "slug", "sku", "brand", "name", "size", "description", "searchKeywords"];
  const incomplete = currentKalahari.find((product) => required.some((field) => !String(product[field] || "").trim()) || !Array.isArray(product.categories) || !product.categories.length || !Number.isFinite(Number(product.price)) || product.active !== true || product.hidden !== false);
  if (incomplete) throw new Error(`Incomplete Kalahari product: ${incomplete.sku || incomplete.name || incomplete.id}.`);
  for (const product of currentKalahari) {
    if (!await fileExists(resolve(root, product.image))) throw new Error(`Missing product image asset for ${product.sku}: ${product.image}.`);
  }
  for (const field of ["id", "slug", "sku"]) {
    const duplicates = duplicateValues(currentKalahari, field);
    if (duplicates.length) throw new Error(`Duplicate Kalahari ${field}: ${duplicates.join(", ")}.`);
  }
  console.log(`Kalahari catalogue check passed: ${catalogue.length} PDF products, ${currentKalahari.length} committed products, no duplicate catalogue SKUs.`);
} else {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(productsPath, `${JSON.stringify(nextProducts, null, 2)}\n`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    catalogueProducts: report.catalogueProducts,
    existingProductsUpdated: report.existingProductsUpdated,
    newProductsCreated: report.newProductsCreated,
    skippedProducts: report.skippedProducts.length,
    duplicateCatalogueSkus: report.duplicateCatalogueSkus,
    obsoleteProductsRemoved: report.obsoleteProductsRemoved.length,
    finalTotalProducts: report.finalTotalProducts,
  }, null, 2));
}
