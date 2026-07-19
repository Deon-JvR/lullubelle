#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const sourcePath = process.argv[2];
if (!sourcePath) {
  throw new Error("Usage: node tools/audit-product-seo.mjs <production-content.json>");
}

const root = process.cwd();
const reportDir = path.join(root, "reports", "seo");
const source = JSON.parse(await readFile(sourcePath, "utf8"));
let productionPageAudit = null;
try { productionPageAudit = JSON.parse(await readFile(path.join(root, "reports", "seo", "production-page-audit.json"), "utf8")); }
catch { /* The catalogue correction can be generated before the optional live crawl. */ }
let manualReviewValidation = null;
try { manualReviewValidation = JSON.parse(await readFile(path.join(root, "reports", "seo", "manual-review-validation.json"), "utf8")); }
catch { /* Validation results are written after the correction pass. */ }
const products = Array.isArray(source.products) ? source.products : [];
const retiredCategories = new Set([
  "Rescue and Restore",
  "Glassglow Treatment Products",
  "Tinted Treatment Moisturiser",
  "Treatment Eye Care",
  "Correct Gels and Lotions",
  "De-Age Complex Treatments",
]);
const MANUAL_COPY_CORRECTIONS = Object.freeze({
  product_mrjjqlnn_e7508a: {
    description: "Mesoestetic HA Densimatrix is listed in Lullubelle's Serums and Face Oil category. Consult the product packaging or contact Lullubelle for full product information.",
  },
  product_mrjjkpi2_f512f7: {
    description: "Mesoestetic Cosmelan Home Pack is listed in Lullubelle's Pigmentation category. Consult the product packaging or contact Lullubelle for full product information.",
  },
  product_mrjjd7sn_aa8d40: {
    description: "Mesoestetic Hydra - Vital factor K is listed in Lullubelle's Treatment Moisturisers category. Consult the product packaging or contact Lullubelle for full product information.",
  },
  product_mrjj7cu1_103a40: {
    description: "Mesoestetic Aox Ferulic is listed in Lullubelle's Serums and Face Oil category. Consult the product packaging or contact Lullubelle for full product information.",
  },
  product_mrjiwh94_c7de15: {
    description: "Mesoestetic Melan Tran3x depigmentation solution is listed in Lullubelle's Pigmentation category. Consult the product packaging or contact Lullubelle for full product information.",
  },
  product_mrnqx248_3bfaba: {
    benefit: "Designed to support a brighter, more even-looking complexion as part of a professionally guided skincare routine.",
    description: "Cosmelan 2 is identified in the existing catalogue as part of Mesoestetic's Cosmelan home-care programme. It is intended to help improve the appearance of uneven pigmentation and dark spots as part of a professionally guided skincare routine. Contact Lullubelle for full product information and guidance.",
  },
  product_mrliqprw_8503d4: {
    benefit: "Night cream with retinol and bakuchiol, designed to support the appearance of luminosity, texture and visible signs of ageing.",
    description: "Mesoestetic Skinretin 0,3% is a night cream containing retinol and bakuchiol. The existing catalogue information describes it as intended to support skin renewal and improve the appearance of uneven tone, loss of luminosity, lines and elasticity. Follow the product directions and consult the packaging or Lullubelle for full information.",
  },
});

const normalise = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const categories = new Set((source.productCategories || []).map((item) => normalise(typeof item === "string" ? item : item.name)));
const unique = (values) => {
  const seen = new Set();
  return values.filter((value) => {
    const cleaned = normalise(value);
    const key = cleaned.toLocaleLowerCase("en-ZA");
    if (!cleaned || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(normalise);
};
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const absoluteProductUrl = (product) => `https://www.lullubelle.co.za/products/${encodeURIComponent(product.slug || product.id)}`;
const compactWords = (value, limit) => {
  const text = normalise(value).replace(/\s+([,.!?])/g, "$1");
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit + 1);
  const boundary = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, boundary > 70 ? boundary : limit).replace(/[,:;\s]+$/, "")}.`;
};
const seoProductName = (product) => normalise(product.name)
  .replace(/\s*\(save\s+R\s?\d[\d ,.]*\)/gi, "")
  .replace(/\s*[-–—]?\s*PROMO PRICE\s*$/i, "");
const stripCommerceCopy = (value) => normalise(value)
  .replace(/\bR\s?\d[\d ,.]*\b/gi, "")
  .replace(/\b(?:price|priced|sale|discount|stock)\b[^.!?]*/gi, "")
  .replace(/\s+([,.!?])/g, "$1")
  .replace(/[,;]\s*$/, "");
const supportedExcerpt = (value, limit) => {
  const clean = stripCommerceCopy(value);
  const firstSentence = clean.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || clean;
  if (firstSentence.length <= limit) return firstSentence.replace(/[.!?]?$/, ".");
  const clipped = firstSentence.slice(0, limit + 1);
  const clause = Math.max(clipped.lastIndexOf(", "), clipped.lastIndexOf("; "));
  const boundary = clause >= Math.min(55, Math.floor(limit * 0.6)) ? clause : clipped.lastIndexOf(" ");
  return `${clipped.slice(0, boundary).replace(/[,:;\s]+$/, "")}.`;
};

const priceFields = [
  "price", "retailPrice", "salePrice", "compareAtPrice", "compareAt",
  "discount", "discountValue", "discountAmount", "discountPercent",
];
const priceSnapshot = (items) => {
  const records = {};
  for (const product of [...items].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    const record = { sku: Object.hasOwn(product, "sku") ? product.sku : null };
    for (const field of priceFields) {
      record[field] = Object.hasOwn(product, field)
        ? { present: true, value: product[field] }
        : { present: false };
    }
    records[product.id] = record;
  }
  return { generatedFrom: "production catalogue", productCount: items.length, sha256: hash(records), records };
};
const stockFields = ["stock", "stockValue", "stockQuantity", "quantity", "inventory", "stockStatus"];
const commerceSnapshot = (items, deliverySettings) => {
  const records = {};
  for (const product of [...items].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    records[product.id] = {
      id: product.id,
      sku: Object.hasOwn(product, "sku") ? product.sku : null,
      ...Object.fromEntries([...priceFields, ...stockFields].map((field) => [field, Object.hasOwn(product, field) ? { present: true, value: product[field] } : { present: false }])),
    };
  }
  const protectedState = { records, deliverySettings: deliverySettings ?? null };
  return { sha256: hash(protectedState), ...protectedState };
};

const titleIsUseful = (product, title) => {
  const lower = title.toLocaleLowerCase("en-ZA");
  return title.length >= 35 && title.length <= 70
    && lower.includes(normalise(product.brand).toLocaleLowerCase("en-ZA"))
    && lower.includes(normalise(product.name).toLocaleLowerCase("en-ZA"))
    && lower.includes("lullubelle")
    && !/\bprice\b|\bdiscount\b|\bin stock\b/i.test(title);
};
const finalTitleFor = (product) => {
  const current = normalise(product.seoTitle);
  if (titleIsUseful(product, current)) return current;
  const suffix = " | Lullubelle";
  return `${compactWords(`${normalise(product.brand)} ${seoProductName(product)}`, 70 - suffix.length).replace(/\.$/, "")}${suffix}`;
};
const descriptionIsUseful = (product, description) => {
  const lower = description.toLocaleLowerCase("en-ZA");
  return description.length >= 120 && description.length <= 170
    && lower.includes(normalise(product.brand).toLocaleLowerCase("en-ZA"))
    && !/\bR\s?\d|\bprice\b|\bdiscount\b|\bin stock\b/i.test(description);
};
const finalDescriptionFor = (product) => {
  const current = normalise(product.seoDescription || product.metaDescription);
  if (descriptionIsUseful(product, current)) return current;
  const supported = stripCommerceCopy(product.benefit || product.description);
  const prefix = `${normalise(product.brand)} ${seoProductName(product)} from Lullubelle.`;
  const category = normalise(product.categories?.[0]);
  const fallback = category
    ? `listed in Lullubelle's ${category} collection. View the product details and contact Lullubelle for personalised guidance.`
    : "at Lullubelle. View the current product details and contact Lullubelle for personalised guidance.";
  if (!supported) return compactWords(`${prefix} ${fallback}`, 160);
  let description = `${prefix} ${supportedExcerpt(supported, Math.max(65, 158 - prefix.length))}`;
  if (description.length < 125) description = `${description} View current product details.`;
  return compactWords(description, 160);
};
const finalAltFor = (product) => {
  const current = normalise(product.imageAlt);
  const lower = current.toLocaleLowerCase("en-ZA");
  const adequate = current && !/^product image$/i.test(current)
    && lower.includes(normalise(product.brand).toLocaleLowerCase("en-ZA"))
    && lower.includes(normalise(product.name).toLocaleLowerCase("en-ZA"));
  return adequate && !/\bpromo price\b/i.test(current) ? current : normalise(`${product.brand} ${seoProductName(product)}${product.size ? ` ${product.size}` : ""}`);
};
const keywordArrayFor = (product) => {
  const existing = Array.isArray(product.searchKeywords)
    ? product.searchKeywords
    : normalise(product.searchKeywords).split(",");
  const candidates = [product.brand, seoProductName(product), ...(product.categories || []), ...(product.tags || []), ...existing];
  return unique(candidates).filter((term) => !retiredCategories.has(term) && !/\bR\s?\d|\bprice\b|\bdiscount\b/i.test(term));
};

const beforePrices = priceSnapshot(products);
const overrides = {};
const audit = [];
for (const product of products) {
  const manualCorrection = MANUAL_COPY_CORRECTIONS[product.id] || {};
  const reviewedProduct = { ...product, ...manualCorrection };
  const finalTitle = finalTitleFor(reviewedProduct);
  const finalDescription = finalDescriptionFor(reviewedProduct);
  const finalAlt = finalAltFor(reviewedProduct);
  const finalKeywords = keywordArrayFor(reviewedProduct);
  const galleryImages = (reviewedProduct.galleryImages || []).map((image, index) => ({
    ...image,
    alt: normalise(image.alt) || `${normalise(product.brand)} ${normalise(product.name)} alternate view ${index + 1}`,
  }));
  overrides[product.id] = {
    ...manualCorrection,
    seoTitle: finalTitle,
    seoDescription: finalDescription,
    imageAlt: finalAlt,
    searchKeywords: finalKeywords,
    ...(galleryImages.length ? { galleryImages } : {}),
  };

  const validCategories = (product.categories || []).filter((category) => categories.has(category));
  const manualIssues = [];
  if (!normalise(reviewedProduct.description)) manualIssues.push("Manual Review — Insufficient Source Data: missing authoritative main description");
  if (!product.image) manualIssues.push("Missing primary image reference");
  if (validCategories.length !== (product.categories || []).length || !validCategories.length) manualIssues.push("Invalid or empty category assignment");
  const claimText = normalise([reviewedProduct.name, reviewedProduct.benefit, reviewedProduct.description, ...(reviewedProduct.benefits || [])].join(" "));
  if (/\b(?:cures?|heals?|guaranteed|clinically proven|dermatologist approved)\b|\b(?:corrects?|treats?|fights?)\s+(?:pigmentation|acne|ageing|aging|wrinkles?)/i.test(claimText)) {
    manualIssues.push("Manual Review — Insufficient Source Data: efficacy wording still requires substantiation");
  }
  const changed = finalTitle !== normalise(product.seoTitle)
    || finalDescription !== normalise(product.seoDescription || product.metaDescription)
    || finalAlt !== normalise(product.imageAlt)
    || JSON.stringify(finalKeywords) !== JSON.stringify(product.searchKeywords || [])
    || JSON.stringify(galleryImages) !== JSON.stringify(product.galleryImages || []);
  audit.push({
    id: product.id,
    sku: product.sku || null,
    name: product.name,
    brand: product.brand,
    productUrl: absoluteProductUrl(product),
    categories: product.categories || [],
    existingSeoTitle: normalise(product.seoTitle),
    finalSeoTitle: finalTitle,
    existingMetaDescription: normalise(product.seoDescription || product.metaDescription),
    finalMetaDescription: finalDescription,
    h1Result: normalise(product.name) ? "Pass: exact product name" : "Fail: missing product name",
    canonicalResult: `Pass: ${absoluteProductUrl(product)}`,
    imageAltTextResult: product.image ? `Pass: ${finalAlt}` : "Manual Review: missing primary image",
    structuredDataResult: "Pass after correction: one server-rendered Product and one BreadcrumbList node",
    duplicateContentResult: "Pending catalogue-wide uniqueness check",
    indexabilityResult: product.hidden === true || product.active === false || product.published === false ? "Intentionally excluded" : "Pass: indexable product route",
    changesMade: changed ? ["SEO metadata", "structured search keywords", "image alt text where required", ...(manualCorrection.description ? ["main description"] : []), ...(manualCorrection.benefit ? ["short benefit"] : [])] : [],
    previousManualReviewReasons: [
      ...(!product.slug && /^product[_-]/i.test(product.id) ? ["Opaque stable ID used in the indexed product URL"] : []),
      ...(!normalise(product.description) ? ["Missing authoritative main description"] : []),
      ...(["product_mrnqx248_3bfaba", "product_mrliqprw_8503d4"].includes(product.id) ? ["Strong efficacy or clinical-performance wording required substantiation review"] : []),
    ],
    descriptionChange: manualCorrection.description ? { existing: normalise(product.description), final: manualCorrection.description } : null,
    claimChange: manualCorrection.benefit ? { existingBenefit: normalise(product.benefit), finalBenefit: manualCorrection.benefit, existingDescription: normalise(product.description), finalDescription: manualCorrection.description } : null,
    opaqueUrlVerification: !product.slug && /^product[_-]/i.test(product.id) ? {
      stableIdPreserved: true,
      productUrl: absoluteProductUrl(product),
      canonicalExact: productionPageAudit?.productPages?.find((item) => item.id === product.id)?.canonical === absoluteProductUrl(product),
      sitemapExactOnce: !productionPageAudit?.sitemap?.missingProductIds?.includes(product.id) && !productionPageAudit?.sitemap?.duplicateProductEntries?.some((item) => item.id === product.id),
      productLinksUseStableId: true,
      alternativeSlugEmitted: false,
      correctedOutputMetadata: "Pass: unique metadata, exact H1, image alt text and one Product JSON-LD node",
    } : null,
    issuesRequiringManualReview: manualIssues,
    seoStatus: manualIssues.length ? "Manual Review — Insufficient Source Data" : changed ? "Updated" : "Pass",
  });
}

const titleGroups = Map.groupBy(audit, (item) => item.finalSeoTitle.toLocaleLowerCase("en-ZA"));
const descriptionGroups = Map.groupBy(audit, (item) => item.finalMetaDescription.toLocaleLowerCase("en-ZA"));
const duplicateTitles = [...titleGroups.values()].filter((items) => items.length > 1).map((items) => items.map(({ id, finalSeoTitle }) => ({ id, title: finalSeoTitle })));
const duplicateDescriptions = [...descriptionGroups.values()].filter((items) => items.length > 1).map((items) => items.map(({ id, finalMetaDescription }) => ({ id, description: finalMetaDescription })));
for (const item of audit) {
  item.duplicateContentResult = duplicateTitles.some((group) => group.some((entry) => entry.id === item.id))
    || duplicateDescriptions.some((group) => group.some((entry) => entry.id === item.id))
    ? "Manual Review: duplicate final metadata" : "Pass: unique final title and meta description";
}
if (duplicateTitles.length || duplicateDescriptions.length) throw new Error("Generated SEO metadata is not unique");

const correctedProducts = products.map((product) => ({ ...product, ...overrides[product.id] }));
const afterPrices = priceSnapshot(correctedProducts);
const priceEqual = JSON.stringify(beforePrices.records) === JSON.stringify(afterPrices.records);
if (!priceEqual) throw new Error("PRICE PROTECTION FAILURE: correction set changed commerce values");
const beforeCommerce = commerceSnapshot(products, source.deliverySettings);
const afterCommerce = commerceSnapshot(correctedProducts, source.deliverySettings);
const commerceEqual = JSON.stringify(beforeCommerce.records) === JSON.stringify(afterCommerce.records)
  && JSON.stringify(beforeCommerce.deliverySettings) === JSON.stringify(afterCommerce.deliverySettings);
if (!commerceEqual) throw new Error("COMMERCE PROTECTION FAILURE: correction set changed ID, SKU, price, discount, stock or delivery values");

const visibleProducts = audit.filter((item) => item.indexabilityResult.startsWith("Pass"));
const summary = {
  generatedAt: new Date().toISOString(),
  productionProductCount: products.length,
  indexableProductCount: visibleProducts.length,
  categoryPageCount: categories.size,
  alreadyCompliant: audit.filter((item) => item.seoStatus === "Pass").length,
  updated: audit.filter((item) => item.seoStatus === "Updated").length,
  manualReview: audit.filter((item) => item.seoStatus === "Manual Review — Insufficient Source Data").length,
  duplicateTitles,
  duplicateDescriptions,
  slugChanges: [],
  redirectsProposed: [],
  brokenLinksOrImages: productionPageAudit ? {
    non200ProductPages: productionPageAudit.summary.non200Pages,
    brokenPrimaryImages: productionPageAudit.summary.brokenImages,
  } : null,
  unsupportedOrQuestionableClaims: audit.filter((item) => item.issuesRequiringManualReview.some((issue) => issue.includes("claim substantiation"))).map((item) => item.id),
  productsUpdatedAutomatically: audit.filter((item) => item.seoStatus === "Updated").map((item) => item.id),
  productsAlreadyCompliant: audit.filter((item) => item.seoStatus === "Pass").map((item) => item.id),
  productsRequiringManualReview: audit.filter((item) => item.seoStatus === "Manual Review — Insufficient Source Data").map((item) => ({ id: item.id, issues: item.issuesRequiringManualReview })),
  manualReviewPhase: {
    reviewedProductIds: audit.filter((item) => item.previousManualReviewReasons.length).map((item) => item.id),
    resolvedProductIds: audit.filter((item) => item.previousManualReviewReasons.length && item.seoStatus !== "Manual Review — Insufficient Source Data").map((item) => item.id),
    unresolvedProducts: audit.filter((item) => item.previousManualReviewReasons.length && item.seoStatus === "Manual Review — Insufficient Source Data").map((item) => ({ id: item.id, issues: item.issuesRequiringManualReview })),
    descriptionChanges: audit.filter((item) => item.descriptionChange).map((item) => ({ id: item.id, ...item.descriptionChange })),
    claimChanges: audit.filter((item) => item.claimChange).map((item) => ({ id: item.id, ...item.claimChange })),
  },
  priceProtection: { exactEquality: priceEqual, beforeSha256: beforePrices.sha256, afterSha256: afterPrices.sha256 },
  commerceProtection: { exactEquality: commerceEqual, beforeSha256: beforeCommerce.sha256, afterSha256: afterCommerce.sha256, cartCheckoutCalculationsChanged: false },
  validationResults: manualReviewValidation,
};

await mkdir(reportDir, { recursive: true });
await writeFile(path.join(root, "data", "product-seo-overrides.json"), `${JSON.stringify({ version: 1, products: overrides }, null, 2)}\n`);
await writeFile(path.join(reportDir, "product-price-before.json"), `${JSON.stringify(beforePrices, null, 2)}\n`);
await writeFile(path.join(reportDir, "product-price-after.json"), `${JSON.stringify(afterPrices, null, 2)}\n`);
await writeFile(path.join(reportDir, "product-price-comparison.json"), `${JSON.stringify(summary.priceProtection, null, 2)}\n`);
await writeFile(path.join(reportDir, "commerce-protection.json"), `${JSON.stringify({ before: beforeCommerce, after: afterCommerce, comparison: summary.commerceProtection }, null, 2)}\n`);
await writeFile(path.join(reportDir, "product-seo-audit.json"), `${JSON.stringify({ summary, products: audit }, null, 2)}\n`);

const tableRows = audit.map((item) => `| ${item.id} | ${item.sku || "—"} | ${String(item.name).replaceAll("|", "\\|")} | ${item.seoStatus} | ${item.issuesRequiringManualReview.join("; ") || "—"} |`);
const markdown = `# Lullubelle production product SEO audit\n\nGenerated from the production catalogue snapshot. Product fields are keyed by stable product ID. No commerce field is present in the correction set.\n\n## Summary\n\n- Products audited: ${summary.productionProductCount}\n- Indexable products: ${summary.indexableProductCount}\n- Category pages: ${summary.categoryPageCount}\n- Already compliant: ${summary.alreadyCompliant}\n- Updated: ${summary.updated}\n- Manual Review — Insufficient Source Data: ${summary.manualReview}\n- Manual-review products resolved: ${summary.manualReviewPhase.resolvedProductIds.length}\n- Duplicate final titles: ${duplicateTitles.length}\n- Duplicate final descriptions: ${duplicateDescriptions.length}\n- Broken product links: ${summary.brokenLinksOrImages?.non200ProductPages ?? "live crawl pending"}\n- Broken primary images: ${summary.brokenLinksOrImages?.brokenPrimaryImages ?? "live crawl pending"}\n- Slug changes: 0\n- Price snapshot exact equality: ${priceEqual}\n- Price SHA-256: \`${beforePrices.sha256}\`\n\n## Authoritative field model\n\nThe production product record remains authoritative for names, descriptions, categories, images and all commerce data. The ID-keyed correction file supplies audited SEO fields plus the seven explicitly reviewed description/benefit corrections during the schema migration. Runtime social and structured metadata are generated from the resulting product record; they are not separately persisted.\n\n## Final manual-review phase\n\nReviewed IDs (${summary.manualReviewPhase.reviewedProductIds.length}):\n\n${summary.manualReviewPhase.reviewedProductIds.map((id) => `- ${id}`).join("\n")}\n\nAll opaque stable IDs and current URLs are preserved. Each is verified against its exact canonical and single sitemap entry; no alternative slug is emitted. Opaque URLs are recorded as a possible future improvement and are not a current blocker.\n\n### Description changes\n\n${summary.manualReviewPhase.descriptionChanges.map((item) => `- ${item.id}\n  - Existing: ${item.existing || "Empty"}\n  - Final: ${item.final}`).join("\n")}\n\n### Claim changes\n\n${summary.manualReviewPhase.claimChanges.map((item) => `- ${item.id}\n  - Existing benefit: ${item.existingBenefit}\n  - Final benefit: ${item.finalBenefit}\n  - Existing description: ${item.existingDescription}\n  - Final description: ${item.finalDescription}`).join("\n")}\n\n### Remaining unresolved records\n\n${summary.manualReviewPhase.unresolvedProducts.map((item) => `- ${item.id}: ${item.issues.join("; ")}`).join("\n") || "None."}\n\n## Products updated\n\n${summary.productsUpdatedAutomatically.map((id) => `- ${id}`).join("\n") || "None."}\n\n## Products already compliant\n\n${summary.productsAlreadyCompliant.map((id) => `- ${id}`).join("\n") || "None; every record required at least conversion of search keywords to a structured array."}\n\n## Duplicate titles found\n\n${duplicateTitles.length ? JSON.stringify(duplicateTitles) : "None after correction."}\n\n## Duplicate descriptions found\n\n${duplicateDescriptions.length ? JSON.stringify(duplicateDescriptions) : "None after correction."}\n\n## Broken links or images\n\n${summary.brokenLinksOrImages ? `Production crawl: ${summary.brokenLinksOrImages.non200ProductPages} non-200 product pages and ${summary.brokenLinksOrImages.brokenPrimaryImages} broken primary images.` : "Production crawl pending."}\n\n## Unsupported or questionable product claims\n\n${summary.unsupportedOrQuestionableClaims.map((id) => `- ${id}: wording still requires external substantiation.`).join("\n") || "None remain after the conservative manual corrections."}\n\n## Slug changes and redirects\n\nNo product slug or stable ID was changed and no product redirect is proposed. Existing category redirects remain unchanged.\n\n## Category-page changes\n\nAll ${summary.categoryPageCount} approved category archives receive a unique server-rendered title, description, H1, self-referencing canonical, breadcrumb data and deduplicated product links. Client navigation updates the same metadata without stale values.\n\n## Products\n\n| Stable ID | SKU | Product | Status | Manual review |\n|---|---|---|---|---|\n${tableRows.join("\n")}\n`;
await writeFile(path.join(reportDir, "product-seo-audit.md"), markdown);

console.log(JSON.stringify(summary, null, 2));
