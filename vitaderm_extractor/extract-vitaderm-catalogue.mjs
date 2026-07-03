import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';
import XLSX from 'xlsx';
import sharp from 'sharp';

const BASE = 'https://vitaderm.co.za';
const OUT = './vitaderm-output';
const IMG_DIR = path.join(OUT, 'images', 'vitaderm');
const CSV_PATH = path.join(OUT, 'vitaderm_complete_catalogue_for_codex.csv');
const JSON_PATH = path.join(OUT, 'vitaderm_complete_catalogue_for_codex.json');
const XLSX_PATH = path.join(OUT, 'vitaderm_complete_catalogue_for_codex.xlsx');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (s = '') => s.replace(/\s+/g, ' ').replace(/Â/g, '').trim();
const slugify = (s = '') => clean(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

async function fetchText(url, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; Lullubelle catalogue extraction; authorised stockist data preparation)',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    if (res.ok) return await res.text();
    if ([429, 500, 502, 503, 504].includes(res.status)) await wait(1500 * (i + 1));
    else throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }
  throw new Error(`Failed after retries: ${url}`);
}

async function discoverProductUrls() {
  const candidates = [`${BASE}/sitemap.xml`, `${BASE}/product-sitemap.xml`, `${BASE}/shop-the-range/`];
  const urls = new Set();

  for (const url of candidates) {
    try {
      const body = await fetchText(url);
      const matches = [...body.matchAll(/https:\/\/vitaderm\.co\.za\/product\/[^<"'\s]+/g)].map(m => m[0]);
      for (const m of matches) urls.add(m.replace(/\?.*$/, '').replace(/\/$/, '/') );

      if (url.endsWith('/shop-the-range/')) {
        const $ = cheerio.load(body);
        $('a[href*="/product/"]').each((_, a) => {
          const href = $(a).attr('href');
          if (href) urls.add(new URL(href, BASE).href.replace(/\?.*$/, '').replace(/\/$/, '/') );
        });
      }
    } catch (e) {
      console.warn(`Discovery skipped ${url}: ${e.message}`);
    }
  }

  return [...urls].filter(u => u.includes('/product/')).sort();
}

function sectionText($, heading) {
  const h = $('h2,h3,h4').filter((_, el) => clean($(el).text()).toLowerCase().includes(heading.toLowerCase())).first();
  if (!h.length) return '';
  const parts = [];
  let node = h.next();
  while (node.length && !/^h[234]$/i.test(node[0].tagName || '')) {
    const t = clean(node.text());
    if (t) parts.push(t);
    node = node.next();
  }
  return parts.join('\n');
}

async function downloadImage(url, fileBase) {
  if (!url) return '';
  try {
    await fs.mkdir(IMG_DIR, { recursive: true });
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const filename = `${fileBase}.webp`;
    const filepath = path.join(IMG_DIR, filename);
    await sharp(buffer).resize({ width: 900, withoutEnlargement: true }).webp({ quality: 82 }).toFile(filepath);
    return `images/vitaderm/${filename}`;
  } catch (e) {
    console.warn(`Image failed ${url}: ${e.message}`);
    return url;
  }
}

async function scrapeProduct(url) {
  const html = await fetchText(url);
  const $ = cheerio.load(html);

  const name = clean($('h1.product_title, h1.entry-title, h1').first().text());
  const category = clean($('.posted_in a').first().text() || $('.product_meta a[rel="tag"]').first().text() || $('.woocommerce-breadcrumb a').last().text());
  const price = clean($('.summary .price, p.price, .price').first().text()).replace(/\s/g, ' ');
  const shortDescription = clean($('.woocommerce-product-details__short-description').text() || $('.summary p').first().text());
  const description = clean($('#tab-description').text() || $('.woocommerce-Tabs-panel--description').text() || $('div[itemprop="description"]').text());
  const benefits = sectionText($, 'benefit') || sectionText($, 'recommended');
  const directions = sectionText($, 'direction') || sectionText($, 'use');
  const ingredients = sectionText($, 'ingredient');
  const sizeMatch = `${name} ${shortDescription} ${description}`.match(/\b\d+\s?(ml|g|capsules|sachets|pack)\b/i);
  const size = sizeMatch ? sizeMatch[0].replace(/\s+/g, '') : '';

  let imageUrl = $('meta[property="og:image"]').attr('content') || $('.woocommerce-product-gallery__image img').first().attr('data-large_image') || $('.woocommerce-product-gallery__image img').first().attr('src') || $('img.wp-post-image').first().attr('src') || '';
  if (imageUrl) imageUrl = new URL(imageUrl, BASE).href;

  const slug = slugify(`vitaderm-${name}`);
  const localImage = await downloadImage(imageUrl, slug);

  return {
    brand: 'VitaDerm',
    product_name: name,
    category,
    size,
    price,
    short_description: shortDescription,
    full_description: description,
    benefits,
    directions,
    ingredients,
    skin_type: '',
    skin_concern: '',
    tags: [category, 'VitaDerm'].filter(Boolean).join(', '),
    seo_title: `${name} | VitaDerm Skincare | Lullubelle`,
    meta_description: clean((shortDescription || description).slice(0, 155)),
    url_slug: slug,
    image_source_url: imageUrl,
    local_image_path: localImage,
    image_alt_text: `VitaDerm ${name}`,
    source_url: url,
    related_products: '',
    cross_sell_products: '',
    manual_review_notes: [!size && 'Check size', !ingredients && 'Ingredients not found', !directions && 'Directions not found'].filter(Boolean).join('; ')
  };
}

function toCsv(rows) {
  const headers = Object.keys(rows[0] || {});
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [headers.map(esc).join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const urls = await discoverProductUrls();
  console.log(`Found ${urls.length} product URLs`);
  if (!urls.length) throw new Error('No product URLs discovered. Add URLs manually or check site access.');

  const rows = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`[${i + 1}/${urls.length}] ${url}`);
    try {
      rows.push(await scrapeProduct(url));
      await wait(900);
    } catch (e) {
      console.error(`FAILED ${url}: ${e.message}`);
      rows.push({ brand: 'VitaDerm', product_name: '', source_url: url, manual_review_notes: `Failed scrape: ${e.message}` });
    }
  }

  await fs.writeFile(JSON_PATH, JSON.stringify(rows, null, 2));
  await fs.writeFile(CSV_PATH, toCsv(rows));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'VitaDerm Catalogue');
  XLSX.writeFile(wb, XLSX_PATH);
  console.log(`Done. Files saved in ${OUT}`);
}

main().catch(err => { console.error(err); process.exit(1); });
