import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const listFiles = async (outputRoot) => {
  const files = [];
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name);
      assert(!entry.isSymbolicLink(), `Public output contains a symlink: ${target}`);
      if (entry.isDirectory()) await walk(target);
      if (entry.isFile()) files.push(relative(outputRoot, target).split(sep).join("/"));
    }
  };
  await walk(outputRoot);
  return files.sort();
};

const validateOutput = async (outputRoot) => {
  const files = await listFiles(outputRoot);
  assert(files.every((file) => !file.includes("..") && !file.includes("\\") && !file.startsWith("/")), "Public output contains an unsafe path.");

  const required = [
    "index.html", "shop.html", "admin/index.html", "admin/admin.js", "admin/admin.css",
    "product.html", "robots.txt", "sitemap.xml", "script.js", "styles.css",
    "data/products.json", "assets/brands/kalahari-logo.svg", "products/featured-products.json",
    "before-after/index.html", "before-after-images/microneedling-before.webp",
  ];
  for (const file of required) assert(files.includes(file), `Required public file missing: ${file}`);

  const prohibited = /(^|\/)(?:tools|docs|reports|tests|scripts|migrations|node_modules|\.netlify|\.git)(?:\/|$)|(^|\/)\.[^/]+|(?:\.map|\.bak|\.backup|\.tmp|\.temp|~)$/i;
  assert.equal(files.filter((file) => prohibited.test(file)).length, 0, "Prohibited internal files entered public output.");
  return files;
};

const files = await validateOutput(dist);

const fixtureRoot = await mkdtemp(join(tmpdir(), "lullubelle-publish-boundary-"));
try {
  await mkdir(join(fixtureRoot, "tools"), { recursive: true });
  await cp(join(root, "tools/build-public-site.mjs"), join(fixtureRoot, "tools/build-public-site.mjs"));
  for (const directory of ["admin", "assets", "before-after", "before-after-images", "brand-logos", "data", "products", "public"]) await mkdir(join(fixtureRoot, directory), { recursive: true });
  await writeFile(join(fixtureRoot, "index.html"), "fixture\n");
  await writeFile(join(fixtureRoot, "assets/normal.js"), "export {};\n");
  let fixtureBuild = spawnSync(process.execPath, ["tools/build-public-site.mjs"], { cwd: fixtureRoot, encoding: "utf8" });
  assert.equal(fixtureBuild.status, 0, fixtureBuild.stderr || fixtureBuild.stdout);

  for (const hiddenPath of ["assets/.internal.js", "assets/.well-known-secret.json", "data/.backup.json", "products/.draft.html", "admin/.private.css", "public/.hidden/file.js"]) {
    const target = join(fixtureRoot, hiddenPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, "fixture\n");
    fixtureBuild = spawnSync(process.execPath, ["tools/build-public-site.mjs"], { cwd: fixtureRoot, encoding: "utf8" });
    assert.notEqual(fixtureBuild.status, 0, `Hidden path must fail the build: ${hiddenPath}`);
    const rejectedPath = hiddenPath.split("/").slice(0, hiddenPath.split("/").findIndex((segment) => segment.startsWith(".")) + 1).join("/");
    assert.match(fixtureBuild.stderr, new RegExp(`Hidden paths are not permitted in public output: ${rejectedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    await rm(target, { force: true });
    if (hiddenPath.includes("/.hidden/")) await rm(join(fixtureRoot, "public/.hidden"), { recursive: true, force: true });
  }

  await writeFile(join(fixtureRoot, "data/orders.json"), "[]\n");
  fixtureBuild = spawnSync(process.execPath, ["tools/build-public-site.mjs"], { cwd: fixtureRoot, encoding: "utf8" });
  assert.notEqual(fixtureBuild.status, 0, "Unlisted JSON data must fail the build.");
  assert.match(fixtureBuild.stderr, /Unapproved public JSON file: data\/orders\.json/);
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

const missingRequiredFixture = await mkdtemp(join(tmpdir(), "lullubelle-missing-public-file-"));
try {
  await cp(dist, missingRequiredFixture, { recursive: true });
  await rm(join(missingRequiredFixture, "index.html"));
  await assert.rejects(validateOutput(missingRequiredFixture), /Required public file missing: index\.html/);
} finally {
  await rm(missingRequiredFixture, { recursive: true, force: true });
}
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
