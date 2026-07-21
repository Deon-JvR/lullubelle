#!/usr/bin/env node
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = join(repositoryRoot, "dist");
if (relative(repositoryRoot, outputRoot) !== "dist") throw new Error("Refusing to build outside the repository dist directory.");

const publicRootExtensions = new Set([".html", ".css", ".js", ".xml", ".txt", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico"]);
const publicDirectories = ["admin", "assets", "before-after", "before-after-images", "brand-logos", "data", "products", "public"];
const publicNestedExtensions = new Set([...publicRootExtensions, ".json"]);
const publicJSONFiles = new Set([
  "data/brands.json", "data/gallery.json", "data/kalahari-image-manifest.json", "data/product-categories.json",
  "data/product-seo-overrides.json", "data/products.json", "data/treatments.json", "data/vouchers.json",
  "products/featured-products.json", "products/vitaderm/catalogue.json",
]);
const prohibitedName = /(^|\/)(?:\.env(?:\.|$)|\.git|\.netlify|node_modules|tools|docs|reports|tests|scripts|migrations)(?:\/|$)|(?:\.map|\.bak|\.backup|\.tmp|\.temp|~)$/i;

const copyFile = async (source, destination, extensions) => {
  const rel = relative(repositoryRoot, source).split(sep).join("/");
  if (prohibitedName.test(rel)) throw new Error(`Prohibited public build input: ${rel}`);
  if (!extensions.has(extname(source).toLowerCase())) throw new Error(`Unapproved public file type: ${rel}`);
  if (extname(source).toLowerCase() === ".json" && !publicJSONFiles.has(rel)) throw new Error(`Unapproved public JSON file: ${rel}`);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { force: true, preserveTimestamps: false });
};

const copyDirectory = async (name) => {
  const sourceRoot = join(repositoryRoot, name);
  const visit = async (source) => {
    for (const entry of (await readdir(source, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const sourcePath = join(source, entry.name);
      const relativePath = relative(repositoryRoot, sourcePath).split(sep).join("/");
      if (entry.name.startsWith(".")) throw new Error(`Hidden paths are not permitted in public output: ${relativePath}`);
      const destinationPath = join(outputRoot, relative(repositoryRoot, sourcePath));
      if (entry.isSymbolicLink()) throw new Error(`Symlinks are not permitted in public output: ${relativePath}`);
      if (entry.isDirectory()) await visit(sourcePath);
      if (entry.isFile()) await copyFile(sourcePath, destinationPath, publicNestedExtensions);
    }
  };
  await visit(sourceRoot);
};

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
for (const entry of (await readdir(repositoryRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isFile() || !publicRootExtensions.has(extname(entry.name).toLowerCase())) continue;
  await copyFile(join(repositoryRoot, entry.name), join(outputRoot, entry.name), publicRootExtensions);
}
for (const directory of publicDirectories) await copyDirectory(directory);

const countFiles = async (directory) => {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    count += entry.isDirectory() ? await countFiles(join(directory, entry.name)) : entry.isFile() ? 1 : 0;
  }
  return count;
};
const outputStat = await stat(outputRoot);
if (!outputStat.isDirectory()) throw new Error("Public output directory was not created.");
console.log(`Generated dist with ${await countFiles(outputRoot)} allowlisted public files.`);
