import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {productResponse} from '../netlify/functions/product-page.mjs';
import {legacyProductRedirect} from '../netlify/edge-functions/legacy-product-redirect.js';
const paths=['/product','/product.html'];
const resolveProduct=async url=>{const event={path:'/product',queryStringParameters:Object.fromEntries(url.searchParams)};const r=productResponse(event,content);const headers={...r.headers};if(r.statusCode===301)headers.Location+=url.search;return new Response(r.body || null,{status:r.statusCode,headers});};
import {renderContentPage} from '../netlify/functions/content-page.mjs';
const products=JSON.parse(readFileSync('data/products.json'));
const content={products,treatments:JSON.parse(readFileSync('data/treatments.json')),deliverySettings:{standardPudoFee:60,freeDeliveryThreshold:1000,collectionEnabled:true}};
const ids=['kalahari-facial-cleanser','vitaderm-eye-lip-repair','kalahari-nourishing-eye-balm'];

for(const id of ids){
 for(const path of paths){
  for(const parameter of ['product','id']){
   const request=new Request(`https://review.invalid${path}?${parameter}=${id}&utm_source=legacy`);
   const response=await legacyProductRedirect(request,resolveProduct);
   assert.equal(response.status,301);const destination=new URL(response.headers.get('location'),request.url);
   assert.equal(destination.search,'');assert.equal(destination.hash,'');
   const clean=productResponse({path:destination.pathname},content);assert.equal(clean.statusCode,200);assert.equal(clean.headers.Location,undefined);
   const retained=productResponse({path:destination.pathname,queryStringParameters:{product:id,id:'invalid',utm_source:'legacy'}},content);assert.equal(retained.statusCode,200);assert.equal(retained.headers.Location,undefined);
   assert.equal(retained.body,clean.body,'Canonical path must own identity despite retained query');
  }
 }
}
for(const id of ['unknown-product','__proto__',''])assert.equal((await legacyProductRedirect(new Request(`https://review.invalid/product?product=${id}`),resolveProduct)).status,404);
assert.equal(productResponse({path:'/products/does-not-exist',queryStringParameters:{product:ids[0]}},content).statusCode,404,'Invalid path cannot masquerade as valid query product');
const hidden={...products.find(p=>p.id===ids[0]),hidden:true};assert.equal(productResponse({path:'/product',queryStringParameters:{product:hidden.id}},{products:[hidden]}).statusCode,404);
const toml=readFileSync('netlify.toml','utf8');assert(toml.includes('function = \"legacy-product-redirect\"\n  path = \"/product\"'));assert(toml.includes('function = \"legacy-product-redirect\"\n  path = \"/product.html\"'));assert(!/from = "\/product(?:\.html)?"\s+to = "\/\.netlify\/functions\/product-page"/.test(toml),'Legacy routes must bypass query-forwarding proxy rewrites');
assert(readFileSync('script.js','utf8').includes("category === \"Dermaplaning\" ? '<a href=\"/dermaplaning-centurion\">Dermaplaning</a>'"),'Client pricelist must preserve the server link');
const price=renderContentPage('/pricelist',content);assert(price.includes('<h2 class="treatment-heading"><a href="/dermaplaning-centurion">Dermaplaning</a></h2>'));for(const treatment of content.treatments.filter(t=>t.hidden!==true))assert(price.includes(`data-service-id="${treatment.id}"`));
for(const slug of ['nail-care-kit','lash-brow-care','body-care-gift-set']){
 const html=readFileSync(slug+'.html','utf8');const schemas=[...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(m=>JSON.parse(m[1]));const page=schemas.find(s=>s['@type']==='WebPage');assert(page);assert.equal(page.url,`https://www.lullubelle.co.za/${slug}`);assert(!/"@type"\s*:\s*"(?:Product|Offer|Review|AggregateRating)"/.test(JSON.stringify(schemas)));assert(html.includes('Enquire about this item'));assert(!html.includes('data-cart-add'));
}
console.log('PASS: targeted SEO — 12 valid legacy route/ID cases; clean and retained-query paths; invalid/hidden lookup; direct routing; Dermaplaning HTML link; three enquiry WebPage schemas.');
