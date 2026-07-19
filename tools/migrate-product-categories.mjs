import { readFile, writeFile } from "node:fs/promises";

const productsUrl = new URL("../data/products.json", import.meta.url);
const approved = JSON.parse(await readFile(new URL("../data/product-categories.json", import.meta.url), "utf8"));
const products = JSON.parse(await readFile(productsUrl, "utf8"));
const approvedSet = new Set(approved);

const renamed = new Map([
  ["HOCl Collection", "HOCL Collection"],
  ["Correctors — Gels & Lotion", "Correcting Gels"],
  ["Corrects, Gels and Lotions", "Correcting Gels"],
  ["Correct Gels and Lotions", "Correcting Gels"],
  ["Effective UVA/UVB Protection", "UVA/UVB Protection"],
  ["Support Serums & Face Oil", "Serums and Face Oil"],
  ["Tinted Treatment Moisturisers & Phyto Fluid Foundation", "Tinted SPF"],
  ["Tinted Treatment Moisturisers", "Tinted SPF"],
  ["Tinted Treatment Moisturiser", "Tinted SPF"],
  ["Treatments Eye Care", "Treatment"],
  ["Treatment Eye Care", "Treatment"],
  ["De-age Complex Treatments", "Anti-Aging"],
  ["De-Age Complex Treatments", "Anti-Aging"],
  ["Cleaning Tools & Disposables", "Prepare"],
]);

const assigned = new Map([
  ["soopa-rescue-restore-omega-tissue-oil", ["Treatment", "Hydration"]],
  ["soopa-rescue-restore-gel-cream", ["Treatment Moisturisers", "Hydration"]],
  ["kalahari-vitamin-a-booster", ["Anti-Aging", "Treatment"]],
  ["kalahari-de-age-leave-on-mask", ["Anti-Aging", "Treatment Masks"]],
  ["mesoestetic-hydra-vital-light", ["Treatment Moisturisers", "Hydration"]],
  ["mesoestetic-fast-skin-repair", ["Sensitive Skin Treatments", "Treatment"]],
  ["mesoestetic-skin-balance", ["Sensitive Skin Treatments", "Acne and Breakouts"]],
  ["vitaderm-gentle-eye-make-up-remover", ["Prepare", "Treatment"]],
  ["vitaderm-pre-cleanse", ["Prepare"]],
  ["vitaderm-gentle-cream-cleanser", ["Prepare", "Sensitive Skin Treatments"]],
  ["vitaderm-mild-gel-cleanser", ["Prepare", "Sensitive Skin Treatments"]],
  ["vitaderm-purifying-cleanser", ["Prepare", "Acne and Breakouts"]],
  ["vitaderm-nourishing-cream-cleanser", ["Prepare", "Hydration"]],
  ["vitaderm-conditioning-toner", ["Prepare", "Hydration"]],
  ["vitaderm-regulating-toner", ["Prepare", "Acne and Breakouts"]],
  ["vitaderm-antiseptic-toner", ["Prepare", "Acne and Breakouts"]],
  ["vitaderm-pore-minimising-gel", ["Correcting Gels", "Acne and Breakouts"]],
  ["vitaderm-ultra-light-moisture-cream", ["Treatment Moisturisers", "Hydration"]],
  ["vitaderm-anti-oxidant-cream", ["Treatment Moisturisers", "Anti-Aging"]],
  ["vitaderm-protective-cream", ["Treatment Moisturisers", "Sensitive Skin Treatments"]],
  ["vitaderm-desensitising-cream", ["Treatment Moisturisers", "Sensitive Skin Treatments"]],
  ["vitaderm-enzymatic-exfoliator", ["Prepare"]],
  ["vitaderm-salicylic-powder-exfoliator", ["Prepare", "Acne and Breakouts"]],
  ["vitaderm-skin-polishing-cream", ["Prepare"]],
  ["vitaderm-skin-renewal-gel", ["Correcting Gels", "Anti-Aging"]],
  ["vitaderm-vitality-booster-masque", ["Treatment Masks", "Hydration"]],
  ["vitaderm-lipid-complex", ["Treatment", "Hydration"]],
  ["vitaderm-tissue-repair-complex", ["Treatment", "Sensitive Skin Treatments"]],
  ["vitaderm-aromatic-complex", ["Treatment"]],
  ["vitaderm-nutrient-complex", ["Treatment", "Hydration"]],
  ["vitaderm-soothing-balm", ["Treatment", "Sensitive Skin Treatments"]],
  ["vitaderm-intensive-hydrating-serum", ["Serums and Face Oil", "Hydration"]],
  ["vitaderm-radian-c-serum", ["Serums and Face Oil", "Pigmentation"]],
  ["vitaderm-rapid-hydration-serum", ["Serums and Face Oil", "Hydration"]],
  ["vitaderm-retinol-serum", ["Serums and Face Oil", "Anti-Aging"]],
  ["vitaderm-hydroxy-acid-serum", ["Serums and Face Oil", "Acne and Breakouts"]],
  ["vitaderm-illuminating-lifting-gel", ["Correcting Gels", "Anti-Aging", "Pigmentation"]],
  ["vitaderm-hydrating-treatment-cream", ["Treatment Moisturisers", "Hydration"]],
  ["vitaderm-anti-ageing-treatment-cream", ["Treatment Moisturisers", "Anti-Aging"]],
  ["vitaderm-ceramide-treatment-cream", ["Treatment Moisturisers", "Hydration"]],
  ["vitaderm-purifying-treatment-cream", ["Treatment Moisturisers", "Acne and Breakouts"]],
  ["vitaderm-brightening-treatment-cream", ["Treatment Moisturisers", "Pigmentation"]],
  ["vitaderm-multi-vitamin-treatment-cream", ["Treatment Moisturisers", "Anti-Aging"]],
  ["vitaderm-firming-treatment-cream", ["Treatment Moisturisers", "Anti-Aging"]],
  ["vitaderm-nourish-revitalise-pack", ["Treatment", "Hydration"]],
  ["vitaderm-anti-ageing-eye-cream", ["Treatment", "Anti-Aging"]],
  ["vitaderm-eye-lip-repair", ["Treatment", "Treatment Lip Care"]],
  ["vitaderm-eye-lift-gel", ["Treatment", "Anti-Aging"]],
  ["vitaderm-salicylic-spot-treatment", ["Correcting Gels", "Acne and Breakouts"]],
  ["vitaderm-invisible-photo-defence-spf50", ["UVA/UVB Protection"]],
  ["vitaderm-reflective-sunbarrier-spf25", ["UVA/UVB Protection"]],
  ["vitaderm-rejuvenate-restore-skin-capsules", ["Treatment", "Anti-Aging"]],
  ["vitaderm-retin-glow-skin-capsules", ["Treatment", "Anti-Aging", "Pigmentation"]],
  ["kalahari-skincare-journey-kit-in-travel-bag", ["Prepare", "Treatment"]],
  ["kalahari-age-preventative-kit", ["Anti-Aging", "Treatment"]],
  ["kalahari-sensitive-and-sensitised-kit", ["Sensitive Skin Treatments", "Treatment"]],
  ["kalahari-dry-and-dehydrated-kit", ["Hydration", "Treatment"]],
  ["kalahari-mature-skin-kit", ["Anti-Aging", "Hydration"]],
  ["kalahari-hyperpigmented-skin-kit", ["Pigmentation", "Treatment"]],
  ["kalahari-problematic-skin-kit", ["Acne and Breakouts", "Treatment"]],
]);

const removed = new Set(["Rescue and Restore", "Rescue + Restore", "Glassglow Treatment Products"]);
const migrated = products.map((product) => {
  const oldValues = Array.isArray(product.categories) ? product.categories : [product.category].filter(Boolean);
  let categories = assigned.get(product.id) || oldValues.filter((value) => !removed.has(value)).map((value) => renamed.get(value) || value);
  categories = [...new Set(categories)];
  const invalid = categories.filter((category) => !approvedSet.has(category));
  if (!categories.length || invalid.length) throw new Error(`${product.id} requires category review: ${invalid.join(", ") || "empty"}`);
  const { category: _oldCategory, ...rest } = product;
  const searchKeywords = (Array.isArray(rest.searchKeywords) ? rest.searchKeywords : String(rest.searchKeywords || "").split(","))
    .map((value) => String(value)
      .replaceAll("Treatment Eye Care", "Treatment")
      .replaceAll("Corrects, Gels and Lotions", "Correcting Gels")
      .replaceAll("De-age Complex Treatments", "Anti-Aging")
      .replaceAll("Glassglow Treatment Products", categories.join(", "))
      .replaceAll("Tinted Treatment Moisturisers", "Tinted SPF")
      .trim())
    .filter(Boolean);
  return { ...rest, ...(searchKeywords.length ? { searchKeywords } : {}), categories };
});

await writeFile(productsUrl, `${JSON.stringify(migrated, null, 2)}\n`);
console.log(`Migrated ${migrated.length} products to authoritative category arrays.`);
