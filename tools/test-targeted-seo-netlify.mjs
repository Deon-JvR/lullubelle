import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const base=process.env.SEO_PREVIEW_URL?.replace(/\/$/,'');
if(!base)throw new Error('Set SEO_PREVIEW_URL to the actual Netlify draft URL.');
const catalogue=JSON.parse(readFileSync(process.env.PHASE1_CATALOGUE_SNAPSHOT || 'data/products.json'));
const products=Array.isArray(catalogue)?catalogue:catalogue.products;
const visible=products.filter(p=>p.hidden!==true&&p.active!==false&&p.published!==false);
const results=[];
for(const [id,canonicalId] of [['kalahari-facial-cleanser','kalahari-facial-cleanser'],['vitaderm-eye-lip-repair','vitaderm-eye-lip-repair'],['kalahari-nourishing-eye-balm','kalahari-nourishing-eye-balm-tube']]){
 const p=products.find(p=>p.id===canonicalId);assert(p);const expected=`/products/${p.slug || p.id}`;
 for(const route of ['/product','/product.html'])for(const key of ['product','id']){
  const url=`${base}${route}?${key}=${encodeURIComponent(id)}&utm_source=legacy`;
  const first=await fetch(url,{redirect:'manual'});assert.equal(first.status,301,url);
  const destination=new URL(first.headers.get('location'),base);assert.equal(destination.origin,base);assert.equal(destination.pathname,expected);assert.equal(destination.search,'');assert.equal(destination.hash,'');
  const second=await fetch(destination,{redirect:'manual'});assert.equal(second.status,200);assert.equal(second.headers.get('location'),null);const body=await second.text();assert(body.includes(`href="https://www.lullubelle.co.za${expected}"`));
  results.push({url,firstStatus:301,location:destination.href,secondStatus:200,redirects:1});
 }
}
for(const path of ['/product?product=unknown-product','/product.html?id=unknown-product','/products/unknown-product?product=kalahari-facial-cleanser'])assert.equal((await fetch(base+path,{redirect:'manual'})).status,404,path);
for(const p of visible){const route=`/products/${p.slug || p.id}`;for(const query of ['', '?product=unknown-product&id=vitaderm-eye-lip-repair']){const response=await fetch(base+route+query,{redirect:'manual'});assert.equal(response.status,200,route+query);assert.equal(response.headers.get('location'),null);const html=await response.text();assert(html.includes(`href="https://www.lullubelle.co.za${route}"`));assert(html.includes(`<strong>R${Number(p.price).toFixed(2)}</strong>`));}}
const price=await(await fetch(base+'/pricelist')).text();assert(/<a\s+[^>]*href="\/dermaplaning-centurion"[^>]*>Dermaplaning<\/a>/.test(price));assert.equal((await fetch(base+'/dermaplaning-centurion')).status,200);
for(const slug of ['nail-care-kit','lash-brow-care','body-care-gift-set']){const html=await(await fetch(base+'/'+slug)).text();assert(!/"@type"\s*:\s*"Product"/.test(html));assert(/"@type"\s*:\s*"WebPage"/.test(html));assert(html.includes('Enquire about this item'));}
const sitemap=await(await fetch(base+'/sitemap.xml')).text();assert.equal([...sitemap.matchAll(/<loc>/g)].length,174);assert(!/\/(cart|checkout|admin|payment-success)</.test(sitemap));
const out=process.env.PHASE1_EVIDENCE_DIR;if(out){mkdirSync(out,{recursive:true});writeFileSync(out+'/netlify-redirect-regressions.json',JSON.stringify({base,results,invalidCases:3,cleanProducts:visible.length,retainedQueryProducts:visible.length,dermaplaningLink:true,enquiryWebPages:3,sitemapUrls:174},null,2));}
console.log(`PASS: actual Netlify routing — 12 one-hop clean legacy redirects; 3 invalid cases; ${visible.length} clean URLs and ${visible.length} retained-query URLs; Dermaplaning href; 3 enquiry WebPages; 174 sitemap URLs.`);
