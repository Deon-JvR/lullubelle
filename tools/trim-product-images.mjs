import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const apply = process.argv.includes("--apply");
const roots = process.argv.filter((arg) => !arg.startsWith("--")).slice(2);
const searchRoots = roots.length ? roots : ["products"];
const extensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const report = [];

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }))).flat();
}

for (const file of (await Promise.all(searchRoots.map(walk))).flat().filter((item) => extensions.has(path.extname(item).toLowerCase()))) {
  const image = sharp(file, { failOn: "warning" });
  const metadata = await image.metadata();
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const visible = (x, y) => {
    const offset = (y * info.width + x) * 4;
    const [r, g, b, a] = data.subarray(offset, offset + 4);
    if (a <= 8) return false;
    return !(r >= 248 && g >= 248 && b >= 248);
  };
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
    if (!visible(x, y)) continue;
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < 0) { report.push({ file, status: "review", reason: "no non-white pixels" }); continue; }
  const contentWidth = right - left + 1;
  const contentHeight = bottom - top + 1;
  const occupied = (contentWidth * contentHeight) / (info.width * info.height);
  const edgeContact = left === 0 || top === 0 || right === info.width - 1 || bottom === info.height - 1;
  const candidate = !edgeContact && occupied < 0.72;
  const margin = Math.max(12, Math.round(Math.max(contentWidth, contentHeight) * 0.06));
  const crop = {
    left: Math.max(0, left - margin), top: Math.max(0, top - margin),
    width: Math.min(info.width, right + margin + 1) - Math.max(0, left - margin),
    height: Math.min(info.height, bottom + margin + 1) - Math.max(0, top - margin),
  };
  const entry = { file, dimensions: `${metadata.width}x${metadata.height}`, occupied: Number(occupied.toFixed(3)), crop, status: candidate ? "candidate" : "unchanged" };
  if (apply && candidate) {
    const output = file.replace(/\.[^.]+$/, ".trimmed.webp");
    await sharp(file).extract(crop).resize(1200, 1200, { fit: "contain", background: "#fff", withoutEnlargement: true }).webp({ quality: 88 }).toFile(output);
    entry.output = output;
    entry.status = "written-for-review";
  }
  report.push(entry);
}

await fs.mkdir("reports", { recursive: true });
await fs.writeFile("reports/product-image-trim-report.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(`Audited ${report.length} images; ${report.filter((item) => item.status === "candidate" || item.status === "written-for-review").length} conservative trim candidates.${apply ? " Review .trimmed.webp outputs before replacing originals." : " Re-run with --apply to create review copies."}`);
