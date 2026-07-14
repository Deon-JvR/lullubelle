import fs from "node:fs/promises";

const manifest = JSON.parse(await fs.readFile("data/kalahari-image-manifest.json", "utf8"));
const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const cards = manifest.map((item) => `<article data-status="${item.matchStatus}">
  <div class="image"><img src="../${escape(item.localImagePath)}" alt="${escape(`${item.brand} ${item.productName}`)}" width="320" height="320"></div>
  <strong>${escape(item.sku)}</strong><span>${escape(item.productName)}</span><small>${escape(item.matchStatus)}</small>
</article>`).join("");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Kalahari 77-SKU image contact sheet</title><style>
*{box-sizing:border-box}body{margin:0;padding:28px;background:#f6f4ee;color:#17351f;font:14px/1.35 Arial,sans-serif}h1{margin:0 0 6px;font:700 32px Georgia,serif}.summary{margin:0 0 22px}.grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:12px}article{display:flex;min-width:0;flex-direction:column;gap:4px;padding:10px;border:1px solid #d8dfd7;border-radius:10px;background:#fff}.image{display:flex;aspect-ratio:1;align-items:center;justify-content:center;padding:10px;border-radius:7px;background:#fff}img{width:100%;height:100%;object-fit:contain}strong{font-size:13px}span{min-height:2.7em;font-size:12px}small{margin-top:auto;color:#54715b;font-weight:700;text-transform:uppercase}article[data-status="missing"],article[data-status="needs-review"]{border-color:#b79a62;background:#fffaf0}@media print{body{padding:12px}.grid{gap:6px}article{break-inside:avoid}}
</style></head><body><h1>Kalahari product image verification</h1><p class="summary">All 77 catalogue SKUs · verified photography and honest coming-soon states</p><main class="grid">${cards}</main></body></html>`;
await fs.writeFile("reports/kalahari-contact-sheet.html", html);
console.log(`Wrote 77-card contact sheet.`);
