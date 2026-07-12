import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sanitiseGallery } from "../netlify/functions/_gallery.mjs";

const items = sanitiseGallery([
  { id: "second", title: "Second", image: "/.netlify/functions/admin-asset?key=new", order: 2, featured: true },
  { id: "first", title: "First", image: "../before-after-images/first.webp", order: 1 },
  { id: "draft", image: "/before-after-images/draft.webp", order: 3, status: "draft" },
  { id: "broken", image: "placeholder.webp", order: 4 },
  { id: "first", image: "/before-after-images/duplicate.webp", order: 5 },
], { publicOnly: true });

assert.deepEqual(items.map((item) => item.id), ["first", "second"]);
assert.equal(items[0].image, "/before-after-images/first.webp");
assert.equal(items[1].featured, true);
assert.deepEqual(sanitiseGallery([], { publicOnly: true }), []);

const previewPages = [
  "cosmelan-centurion.html",
  "epilfree-hair-removal-centurion.html",
  "facials-centurion.html",
  "microneedling-centurion.html",
  "online-consultations.html",
];
const previewMarkup = await Promise.all(previewPages.map((file) => readFile(file, "utf8")));
previewMarkup.forEach((html, index) => {
  assert.match(html, /data-managed-gallery-preview=/, `${previewPages[index]} should use the shared gallery renderer.`);
  assert.doesNotMatch(html, /<img[^>]+before-after-images\//i, `${previewPages[index]} should not hard-code a result image.`);
});

const fallback = JSON.parse(await readFile("data/gallery.json", "utf8"));
assert.equal(new Set(fallback.map((item) => item.id)).size, fallback.length);
assert.deepEqual(sanitiseGallery(fallback).map((item) => item.order), [1, 2, 3, 4, 5]);
console.info("Gallery source and sanitization tests passed.");
