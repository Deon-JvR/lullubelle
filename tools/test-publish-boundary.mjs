import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);
const dist = join(root, "dist");
const build = spawnSync(process.execPath, ["tools/build-public-site.mjs"], { cwd: root, encoding: "utf8" });
assert.equal(build.status, 0, build.stderr || build.stdout);

const files = [];
const walk = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    assert(!entry.isSymbolicLink(), `Public output contains a symlink: ${target}`);
    if (entry.isDirectory()) await walk(target);
    if (entry.isFile()) files.push(relative(dist, target).split(sep).join("/"));
  }
};
await walk(dist);
assert(files.every((file) => !file.includes("..") && !file.includes("\\") && !file.startsWith("/")), "Public output contains an unsafe path.");

const required = [
  "index.html", "shop.html", "admin/index.html", "admin/admin.js", "admin/admin.css",
  "product.html", "robots.txt", "sitemap.xml", "script.js", "styles.css",
  "data/products.json", "assets/brands/kalahari-logo.svg", "products/featured-products.json",
  "before-after/index.html", "before-after-images/microneedling-before.webp",
];
for (const file of required) assert(files.includes(file), `Required public file missing: ${file}`);

const prohibited = /(^|\/)(?:tools|docs|reports|tests|scripts|migrations|node_modules|\.netlify|\.git)(?:\/|$)|(^|\/)\.env(?:\.|$)|(?:\.map|\.bak|\.backup|\.tmp|\.temp|~)$/i;
assert.equal(files.filter((file) => prohibited.test(file)).length, 0, "Prohibited internal files entered public output.");
for (const forbidden of [
  "tools/reconcile-ikhokha.mjs", "tools/test-reconcile-ikhokha.mjs",
  "Docs/ikhokha-reconciliation-runbook.md", "Docs/Ikhoka.pdf", "reports/screenshots/example.png",
  ".netlify/state.json", ".env", "backup.bak", "bundle.js.map", "incident.tmp",
]) assert(!files.some((file) => file.toLowerCase() === forbidden.toLowerCase()), `Forbidden path published: ${forbidden}`);

const toml = await readFile(join(root, "netlify.toml"), "utf8");
assert.match(toml, /publish\s*=\s*"dist"/);
assert.match(toml, /directory\s*=\s*"netlify\/functions"/);
for (const prefix of ["tools", "Docs", "docs", "reports", "tests", "scripts", "migrations", "node_modules"]) {
  assert(toml.includes(`from = "/${prefix}/*"`), `Missing defensive deny redirect for /${prefix}/*`);
}
for (const functionFile of ["ikhokha-checkout.mjs", "sitemap.mjs", "shop-page.mjs", "product-page.mjs", "admin-api.mjs"]) {
  assert((await stat(join(root, "netlify/functions", functionFile))).isFile(), `Function source missing: ${functionFile}`);
}
assert.match(toml, /from = "\/sitemap\.xml"[\s\S]*to = "\/\.netlify\/functions\/sitemap"/);
assert.match(toml, /from = "\/shop"[\s\S]*to = "\/\.netlify\/functions\/shop-page"/);
assert.match(toml, /from = "\/products\/\*"[\s\S]*to = "\/\.netlify\/functions\/product-page"/);
assert.match(toml, /\[\[headers\]\][\s\S]*for = "\/\*"/);

console.log(`Publish boundary tests passed for ${files.length} generated files.`);
