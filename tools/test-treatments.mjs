import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  migrateServiceCatalogue,
  SERVICE_CATALOGUE_VERSION,
  validateServiceCatalogue,
} from "../netlify/functions/_services.mjs";

const treatments = JSON.parse(await readFile(new URL("../data/treatments.json", import.meta.url), "utf8"));
const pdfEntries = treatments.filter((item) => item.pdfSource !== false);
const expected = [];
const add = (category, entries) => entries.forEach(([name, price, duration = "", group = ""]) => expected.push({ category, group, name, price, duration }));

add("Booster Treatments", [["Hydrate", "R330"], ["Purify", "R350"], ["NanoGlow", "R400"]]);
add("Signature Treatments", [["Teen Purifying", "R420", "45 min"], ["Pure Hydration", "R450", "50 min"], ["Deep Purifying", "R490", "60 min"], ["Vita C Glow", "R530", "60 min"]]);
add("Advanced Treatments / Kalahari Chemi Peels", [["Face Only", "R430", "30 min"], ["Face & Neck", "R550", "60 min"]]);
add("Vitaderm Peels", [
  ["Face Only", "R570", "", "Lactic Acid"], ["Face & Neck", "R620", "", "Lactic Acid"],
  ["Face Only", "R570", "", "Mandelic"], ["Face & Neck", "R620", "", "Mandelic"],
  ["Face Only", "R570", "", "Glycolic"], ["Face & Neck", "R620", "", "Glycolic"],
]);
add("Microneedling – Dr Pen", [["Face", "R760"], ["Face and Neck", "R820"], ["Face, Neck and Décolleté", "R950"]]);
add("Dermaplaning", [["Quick Glow", "R375", "30 min"], ["Ultimate Glow", "R474", "60 min"]]);
add("Enhancements", [["Light Therapy", "R100"], ["Vitamin C Sheet Mask", "R100"], ["Extractions", "R60"], ["Brow, Lip or Chin Wax", "R50"], ["Brow or Lash Tint", "R50"]]);
add("Massages", [["30 min", "R350", "30 min"], ["45 min", "R400", "45 min"]]);
add("Waxing", [
  ["Nose", "R30"], ["Brow", "R90"], ["Lip", "R80"], ["Chin", "R90"], ["Cheeks", "R100"], ["Full Face", "R260"], ["Under Arm", "R120"], ["Arms, Full", "R200"], ["Arms, Half", "R150"], ["Legs, Full Women", "R330"], ["Legs, Full Men", "R370"], ["Legs, 3/4 Above Knee", "R280"], ["Legs, 1/2 Below Knee", "R220"], ["Bikini", "R200"], ["Brazilian", "R290"], ["Hollywood", "R340"],
]);
add("Waxing Bundles", [["Brow, Lip and Chin", "R240"], ["Brow, Lip and Hollywood", "R490"], ["Brow, Lip, Under Arm and Hollywood", "R600"], ["Brow, Lip, Under Arm, Half Leg and Hollywood", "R750"]]);
add("Tinting", [["Brow", "R90"], ["Lashes", "R100"]]);
add("Gelit Overlay Hands", [["Gelit Overlay Only", "R270"], ["Gelit Soak and Overlay", "R340"]]);
add("Gelit Overlay Toes", [["Gelit Overlay Only", "R240"], ["Gelit Soak and Overlay", "R270"]]);
add("Feet", [["Express Pedicure", "R200"], ["Full Pedicure", "R330"], ["MediHeel Pedi", "R390"], ["MediHeel Add-on", "R120"], ["Gelit Pedi", "R400"]]);

assert.equal(expected.length, 58);
assert.equal(pdfEntries.length, 58);
assert.equal(validateServiceCatalogue(treatments), "");
assert.deepEqual(pdfEntries.map(({ category, group = "", name, price, duration = "" }) => ({ category, group, name, price, duration })), expected);

const keys = pdfEntries.map((item) => [item.category, item.group || "", item.name].join("|").toLowerCase());
assert.equal(new Set(keys).size, keys.length, "PDF service options must not be duplicated");
assert.equal(pdfEntries.some((item) => /Decollete|Mediheel|VitaDerm/.test(`${item.category} ${item.name}`) || /Brazilion/i.test(`${item.category} ${item.name}`)), false);

const migrated = migrateServiceCatalogue({ treatments: [{ id: "obsolete", category: "Old", name: "Waxing", price: "Confirm" }] }, { treatments });
assert.equal(migrated.changed, true);
assert.equal(migrated.content.serviceCatalogueVersion, SERVICE_CATALOGUE_VERSION);
assert.deepEqual(migrated.content.treatments, treatments);
assert.equal(migrateServiceCatalogue(migrated.content, { treatments }).changed, false);

console.log("All 58 Pricelist 2026 Draft 2 entries match the authoritative service catalogue.");
