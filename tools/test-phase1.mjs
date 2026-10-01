import {readContent} from "../netlify/functions/_admin-shared.mjs";
import {reconcileContentImages} from "../netlify/functions/_product-image-reconciliation.mjs";
import {checkoutCatalogue} from "../netlify/functions/ikhokha-checkout.mjs";
import assert from 'node:assert/strict';
import {readFileSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {productResponse, renderProductHtml, productStructuredData} from '../netlify/functions/product-page.mjs';
import {shopResponse, renderShopHtml} from '../netlify/functions/shop-page.mjs';
import {sitemapResponse} from '../netlify/functions/sitemap.mjs';
import {renderContentPage, LEGACY_PRODUCT_IDS} from '../netlify/functions/content-page.mjs';
import {publicProduct, saleProduct, publicContent, shippingDetails, brandsFor, brandSlug} from '../netlify/functions/_public-catalogue.mjs';
import {checkStorage, createStorageHealthHandler} from '../netlify/functions/storage-health.mjs';
import {notifyPaidOrder, notificationMessage} from '../netlify/functions/_order-notification.mjs';
import {receiptFor} from '../netlify/functions/order-receipt.mjs';
const snapshot=process.env.PHASE1_CATALOGUE_SNAPSHOT;
const rawContent=snapshot ? JSON.parse(readFileSync(snapshot,'utf8')) : {products:JSON.parse(readFileSync('data/products.json')),brands:JSON.parse(readFileSync('data/brands.json')),treatments:JSON.parse(readFileSync('data/treatments.json')),gallery:JSON.parse(readFileSync('data/gallery.json')),deliverySettings:{standardPudoFee:60,freeDeliveryThreshold:1000,collectionEnabled:true}};
const content=reconcileContentImages(rawContent);
const visible=content.products.filter(publicProduct),results=[];
if(snapshot){assert.equal(content.products.length,163);assert.equal(visible.length,143);}
const checkout=checkoutCatalogue(content);
for(const p of visible){
 if(saleProduct(p)){assert.equal(checkout.get(p.id).price,Number(p.price));assert.equal(checkout.get(p.id).id,p.id);}
 const response=productResponse({path:`/products/${p.slug || p.id}`},content);assert.equal(response.statusCode,200);
 const html=response.body;assert(html.includes(`<strong>R${Number(p.price).toFixed(2)}</strong>`));assert(html.includes(`data-product-price="${Number(p.price)}"`));
 assert(html.includes(`href="https://www.lullubelle.co.za/products/${p.slug || p.id}"`));assert(!/name="robots"[^>]*noindex/.test(html));
 assert.equal((html.match(/<h1\b/g)||[]).length,1);
 const schema=JSON.parse(html.match(/data-server-product-schema>(.*?)<\/script>/s)[1]);assert.equal(schema.offers.price,p.price);assert.equal(schema.offers.priceCurrency,'ZAR');assert.equal(schema.offers.shippingDetails.length,2);assert.equal(schema.offers.hasMerchantReturnPolicy,undefined);assert.equal(schema.review,undefined);assert.equal(schema.aggregateRating,undefined);
 assert.equal(schema.offers.shippingDetails[0].hasShippingService["@id"],"https://www.lullubelle.co.za/shipping-policy#pudo");
 results.push({id:p.id,url:`/products/${p.slug || p.id}`,status:200,canonical:schema.url,price:p.price,shippingDetails:true});
}
for(const p of content.products.filter(p=>!publicProduct(p)))assert.equal(productResponse({path:`/products/${p.slug || p.id}`},content).statusCode,404);
const hidden={...visible[0],hidden:true};assert.equal(saleProduct(hidden),false);assert.equal(checkoutCatalogue({products:[hidden]}).size,0);assert.equal(saleProduct({...visible[0],stockStatus:'Out of stock'}),false);assert.equal(publicContent({products:[hidden]}).products.length,0);
for(const lookup of ['does-not-exist','__proto__',''])assert.equal(productResponse({path:'/product',queryStringParameters:{product:lookup}},content).statusCode,404);
const valid=productResponse({path:'/product',queryStringParameters:{product:visible[0].id}},content);assert.equal(valid.statusCode,301);assert.equal(valid.headers.Location,`/products/${visible[0].slug || visible[0].id}`);
const legacy=renderContentPage('/skin-care-essentials',content);const original=readFileSync('skin-care-essentials.html','utf8');const reconciliation=[];
for(const m of original.matchAll(/data-product-id="([^"]+)"[^>]*data-product-price="([^"]+)"/g)){
 const id=LEGACY_PRODUCT_IDS[m[1]] || m[1];const p=content.products.find(p=>p.id===id);assert(p,`Unresolved ${m[1]}`);assert(legacy.includes(`data-product-id="${id}"`));assert(legacy.includes(`data-product-price="${Number(p.price)}"`));reconciliation.push({product:p.name,currentPrice:p.price,legacyPrice:Number(m[2]),checkoutId:id,status:publicProduct(p)?'Visible':'Unavailable',correction:m[1]===id?'Managed catalogue price':'Mapped to approved Eye Balm Tube ID'});
}
for(const page of ['nail-care-kit','lash-brow-care','body-care-gift-set']){const html=readFileSync(`${page}.html`,'utf8');assert(!html.includes('data-cart-add'));assert(html.includes('Enquire about this item'));}
const category=renderShopHtml(content,'Prepare');for(const p of visible.filter(p=>p.categories.includes('Prepare')))assert(category.includes(`/products/${p.slug || p.id}`));assert(!category.includes('Loading'));
const brandResults=[];
for(const b of brandsFor(content)){const slug=brandSlug(b),html=shopResponse({path:`/shop/${slug}`},content).body;assert(html.includes(`href="https://www.lullubelle.co.za/shop/${slug}"`));assert(html.includes(`<h1>${b.name} products</h1>`));assert(renderShopHtml(content,'',b.id).includes(`href="https://www.lullubelle.co.za/shop/${slug}"`));assert(!/name="robots"[^>]*noindex/.test(html));brandResults.push({url:`/shop/${slug}`,count:visible.filter(p=>p.brandId===b.id || p.brand===b.name).length,status:200});}
assert(renderShopHtml(content,'Prepare','kalahari','cleanser').includes('noindex,follow'));
const sitemap=sitemapResponse(content).body;assert.equal((sitemap.match(/<loc>/g)||[]).length,25+visible.length+brandResults.length);assert(!/\/(cart|admin|checkout|payment-success)</.test(sitemap));assert(readFileSync('robots.txt','utf8').includes('Sitemap: https://www.lullubelle.co.za/sitemap.xml'));
const shippingHtml=renderContentPage("/shipping-policy",content);const policy=JSON.parse(shippingHtml.match(/data-merchant-shipping-policy>(.*?)<\/script>/s)[1]);assert.equal(policy.hasShippingService[0].shippingConditions[0].shippingRate.value,60);assert.equal(policy.hasShippingService[0].shippingConditions[1].orderValue.minValue,1000);assert.equal(policy.hasShippingService[0].shippingConditions[1].shippingRate.value,0);assert.equal(policy.hasShippingService[1].shippingConditions[0].shippingRate.value,80);assert.equal(policy.hasShippingService[0].handlingTime,undefined);
const pricelist=renderContentPage('/pricelist',content);for(const t of content.treatments.filter(t=>!t.hidden))assert(pricelist.includes(`data-service-id="${t.id}"`));assert(!pricelist.includes('Loading'));
const gallery=renderContentPage('/before-after/',content);assert(!gallery.includes('Loading'));assert((gallery.match(/data-results-card/g)||[]).length>0);
const home=renderContentPage('/',content);assert(home.indexOf("window.LULLUBELLE_INITIAL_CONTENT")>home.indexOf("</main>"),"Homepage bootstrap follows crawlable content but precedes deferred execution");const featuredImages=[...home.matchAll(/<img class="product-card__image"[^>]*>/g)].map(m=>m[0]);assert.equal(featuredImages.length,8);assert(featuredImages.every(i=>i.includes('loading="lazy"')&&!i.includes('fetchpriority="high"')),"Below-fold homepage thumbnails must not compete with the hero");assert(home.includes('41 Tiemie Singel'));assert(!home.includes('Crescent'));assert(home.includes('08:00'));assert(home.includes('openingHoursSpecification'));
let reads=0,writes=0;const store={get:async()=>{reads++;return null},set:()=>writes++,setJSON:()=>writes++,delete:()=>writes++};for(let i=0;i<10;i++)assert(await checkStorage(store));assert.equal(reads,10);assert.equal(writes,0);
const healthHandler=createStorageHealthHandler(()=>store);
for(let i=0;i<10;i++){const response=await healthHandler({httpMethod:"GET"});assert.equal(response.statusCode,200);assert.deepEqual(JSON.parse(response.body),{ok:true});}
assert.equal(reads,20);assert.equal(writes,0);assert.equal((await healthHandler({httpMethod:"POST"})).statusCode,405);
const runtimeBefore=process.env.NETLIFY;
try {process.env.NETLIFY="true";await assert.rejects(readContent(),e=>e.statusCode===503);} finally {runtimeBefore===undefined?delete process.env.NETLIFY:process.env.NETLIFY=runtimeBefore;}
const order={id:'isolated-order',newOrderNotificationVersion:1,orderNumber:'TEST-1234',paymentStatus:'Paid',paymentVerifiedAt:'2026-09-30T10:00:00Z',paidAt:'2026-09-30T10:00:00Z',createdAt:'2026-09-30T09:59:00Z',customer:{name:'Test Customer',email:'test@example.invalid',phone:'0000000000'},products:[{id:'example',name:'Example',quantity:2,price:100}],subtotal:200,total:260,deliveryFee:60,analyticsAccessToken:'isolated-token'};
const records=new Map();let sends=0,fail=false;
const deps={messageOptions:{to:'test@example.invalid',from:'isolated@example.invalid'},create:async(k,v)=>{if(records.has(k))return{modified:false};records.set(k,{value:v,etag:'1'});return{modified:true,etag:'1'}},read:async k=>structuredClone(records.get(k)||{value:null,etag:''}),update:async(k,v,etag)=>{const old=records.get(k);if(old.etag!==etag)throw new Error('CAS conflict');const next={value:structuredClone(v),etag:String(Number(etag)+1)};records.set(k,next);return{modified:true,etag:next.etag}},send:async()=>{if(fail)throw Object.assign(new Error('Isolated transport failure'),{code:'transport',ambiguous:true});sends++;return{id:'fake-delivery'}}};
assert.equal((await notifyPaidOrder({...order,paymentStatus:'Pending'},deps)).state,'ineligible');assert.equal(sends,0);
await Promise.all([notifyPaidOrder(order,deps),notifyPaidOrder(order,deps)]);assert.equal(sends,1);await notifyPaidOrder(order,deps);assert.equal(sends,1);
const failing={...order,id:'isolated-failure',orderNumber:'TEST-FAIL'};fail=true;assert.equal((await notifyPaidOrder(failing,deps)).state,'failed');assert.equal(failing.paymentStatus,'Paid');assert([...records.values()].some(r=>r.value.state==='failed'));fail=false;assert.equal((await notifyPaidOrder(failing,deps)).state,'sent');assert.equal(sends,2);
assert.equal(receiptFor([order],order.orderNumber,'wrong'),null);assert.equal(receiptFor([{...order,paymentStatus:'Pending'}],order.orderNumber,order.analyticsAccessToken).status,'pending');const receipt=receiptFor([order],order.orderNumber,order.analyticsAccessToken);assert.equal(receipt.status,'paid');assert(!JSON.stringify(receipt).includes(order.customer.email));
// Crash after provider acceptance: same provider key returns the same delivery,
// even when durable acknowledgement fails. No second intended email is produced.
const providerKeys=new Set();let accepted=0,breakAcknowledgement=true;
const crashDeps={...deps,send:async (_m,key)=>{if(!providerKeys.has(key)){providerKeys.add(key);accepted++;}return{id:"accepted-once"};},update:async(k,v,etag)=>{if(v.state==="sent" && breakAcknowledgement){breakAcknowledgement=false;throw new Error("Isolated persistence failure");}return deps.update(k,v,etag);}};
const crashOrder={...order,id:"isolated-crash"};assert.equal((await notifyPaidOrder(crashOrder,crashDeps)).state,"failed");assert.equal((await notifyPaidOrder(crashOrder,crashDeps)).state,"sent");assert.equal(accepted,1);
const expiredOrder={...order,id:"isolated-expired"};fail=true;await notifyPaidOrder(expiredOrder,deps);fail=false;assert.equal((await notifyPaidOrder(expiredOrder,{...deps,now:()=>Date.now()+24*60*60*1000})).state,"manual-review");
const email=notificationMessage(order,deps.messageOptions);assert(email.subject.endsWith('PAID'));assert(email.text.includes('2 × R100.00'));
let staleReads=0;
assert.equal((await notifyPaidOrder({...order,id:'isolated-read-lag'},{...deps,read:async()=>{staleReads++;return {value:null,etag:''};}})).state,'sent');
assert.equal(staleReads,0,'A new durable order notification must send without waiting for eventual read visibility');
assert.deepEqual(content.products.map(p=>[p.id,p.price,p.slug]),rawContent.products.map(p=>[p.id,p.price,p.slug]));
for(const product of content.products.filter(p=>p.image !== rawContent.products.find(q=>q.id===p.id)?.image)) assert(existsSync(product.image),`Missing approved image ${product.image}`);
const imageInventory=rawContent.products.filter(p=>publicProduct(p) && p.image?.includes("catalogue-product.svg")).map(p=>({id:p.id,name:p.name,sku:p.sku,before:p.image,after:content.products.find(q=>q.id===p.id).image,status:p.id==="kalahari-treatment-lip-glaze"?"Owner photograph required; generic image omitted from Product schema":"Existing approved SKU image restored"}));
const out=process.env.PHASE1_EVIDENCE_DIR;if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/placeholder-images.json`,JSON.stringify(imageInventory,null,2));writeFileSync(`${out}/product-url-checks.json`,JSON.stringify(results,null,2));writeFileSync(`${out}/brand-routes.json`,JSON.stringify(brandResults,null,2));writeFileSync(`${out}/legacy-reconciliation.json`,JSON.stringify(reconciliation,null,2));writeFileSync(`${out}/notification-tests.json`,JSON.stringify({isolated:true,concurrentAndRetrySends:1,failurePreservesPaidOrder:true,retryAfterFailureSends:1,customerCharge:false},null,2));}
console.log(`Phase 1 regressions passed: ${visible.length} product URLs; ${brandResults.length} brands; legacy IDs/prices; non-mutating health; SSR; hidden sale rules; receipts; notification concurrency/retry/failure isolation.`);
