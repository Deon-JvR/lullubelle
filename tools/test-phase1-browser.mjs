import {reconcileContentImages} from "../netlify/functions/_product-image-reconciliation.mjs";
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const base=process.env.PHASE1_BASE_URL || 'http://127.0.0.1:4174';
const out=process.env.PHASE1_EVIDENCE_DIR || '/private/tmp/lullubelle-phase1-review';mkdirSync(out,{recursive:true});
const content=reconcileContentImages(JSON.parse(readFileSync(process.env.PHASE1_CATALOGUE_SNAPSHOT || '/private/tmp/lullubelle-seo-audit-2026-09-30/catalogue.json')));
const product=content.products.find(p=>p.id==='vitaderm-eye-lip-repair');const kalahari=content.products.find(p=>p.id==='kalahari-facial-cleanser');
const http=[];
for (const product of content.products.filter(p=>p.hidden !== true && p.active !== false && p.published !== false)) {
 const path=`/products/${product.slug || product.id}`;const response=await fetch(base+path);const html=await response.text();assert.equal(response.status,200);assert(html.includes(`href="https://www.lullubelle.co.za${path}"`));assert(html.includes(`<strong>R${Number(product.price).toFixed(2)}</strong>`));http.push({path,status:response.status,canonical:`https://www.lullubelle.co.za${path}`,price:product.price});
}
writeFileSync(`${out}/product-http-checks.json`,JSON.stringify(http,null,2));
const browser=await chromium.launch({headless:true});const results=[];const errors=[];
const routes=['/','/shop','/shop/kalahari',`/products/${product.slug || product.id}`,'/microneedling-centurion','/pricelist','/cart','/before-after/'];
for(const width of [320,375,390,430,1024,1280]){
 const context=await browser.newContext({viewport:{width,height:width<500?844:900}});
 await context.addInitScript(()=>{window.gtag=(...args)=>(window.TEST_EVENTS ||= []).push(args);window.TEST_CLS=0;new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.TEST_CLS+=e.value}).observe({type:'layout-shift',buffered:true});});
 const page=await context.newPage();page.on('pageerror',e=>errors.push({width,error:e.message}));
 await page.route('**google-analytics.com/**',r=>r.abort());await page.route('**googletagmanager.com/**',r=>r.abort());
 for(const path of routes){
  await page.goto(base+path,{waitUntil:'networkidle'});
  if(path==='/' && width<500){const toggle=page.locator('[data-nav-toggle]');await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'true');await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');}
  if(path==='/microneedling-centurion'){await page.locator('main a.button[href*=book-appointment]').first().click();await page.waitForLoadState('networkidle');assert(page.url().includes('book-appointment'));assert.equal(await page.locator('h1').count(),1);await page.goBack({waitUntil:'networkidle'});}

  await page.evaluate(()=>Promise.all([...document.images].filter(i=>i.loading!=='lazy').map(i=>i.complete?Promise.resolve():new Promise(resolve=>{i.onload=i.onerror=resolve}))));
  const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,h1:[...document.querySelectorAll('h1')].map(n=>n.textContent),canonical:document.querySelector('link[rel=canonical]')?.href,cls:window.TEST_CLS,brokenImages:[...document.images].filter(i=>i.loading!=='lazy' && i.complete && !i.naturalWidth).map(i=>i.src),price:document.querySelector('.product-detail-copy>strong')?.textContent,buttons:[...document.querySelectorAll('[data-managed-cart-add],[data-product-detail-cart]')].map(b=>({id:b.dataset.productId,price:Number(b.dataset.productPrice)}))}));
  assert(state.overflow<=1,`${width} ${path} overflow ${state.overflow}`);assert.equal(state.h1.length,1,`${path} H1 count`);assert.equal(state.brokenImages.length,0,`${path} broken images ${JSON.stringify(state.brokenImages)}`);
  if(path.startsWith('/products/'))assert.equal(state.price,`R${Number(product.price).toFixed(2)}`);
  for(const button of state.buttons){const p=content.products.find(p=>p.id===button.id);assert(p);assert.equal(button.price,Number(p.price));assert(!p.hidden);}
  const filename=`responsive-${width}-${path==='/'?'home':path.replace(/[^a-z0-9]+/gi,'-')}.png`;await page.screenshot({path:`${out}/${filename}`,fullPage:true});results.push({width,path,...state,screenshot:filename});
 }
 // Genuine product -> cart -> checkout controls. No checkout/payment request is made.
 await page.goto(`${base}/products/${kalahari.slug || kalahari.id}`,{waitUntil:'networkidle'});await page.locator('[data-product-detail-cart]').click();
 await page.goto(base+'/cart',{waitUntil:'networkidle'});assert.equal(await page.locator('.cart-item').count(),1);
 await page.locator('[data-cart-qty-change="1"]').click();assert((await page.locator('[data-cart-summary-total]').textContent()).includes((Number(kalahari.price)*2).toFixed(2)));await page.locator('[data-cart-qty-change="-1"]').click();
 const cartBefore=await page.locator('[data-cart-summary-total]').textContent();assert(cartBefore.includes(Number(kalahari.price).toFixed(2)));
 await page.locator('input[name=deliveryOption][value=pudo]').check();const pudo=await page.locator('[data-cart-summary-total]').textContent();assert(pudo.includes((Number(kalahari.price)+60).toFixed(2)));
 await page.locator('input[name=deliveryOption][value=door_to_door_flat_rate]').check();const door=await page.locator('[data-cart-summary-total]').textContent();assert(door.includes((Number(kalahari.price)+80).toFixed(2)));
 await page.locator('[data-cart-ikhokha-checkout]').click();assert(await page.locator('[aria-invalid=true]').count()>0);
 await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('.cart-item').count(),1);
 await page.screenshot({path:`${out}/checkout-${width}.png`,fullPage:true});results.push({width,path:'checkout-controls',collection:cartBefore,pudo,door,validation:true,persistence:true,quantityControls:true});
 await context.close();
}
// JavaScript disabled checks inspect text nodes, not JSON-LD substrings.
const nojs=await browser.newContext({javaScriptEnabled:false});const page=await nojs.newPage();const initial=[];
for(const path of ['/','/shop?category=Prepare','/shop/vitaderm',`/products/${product.slug || product.id}`,`/products/${kalahari.slug || kalahari.id}`,'/microneedling-centurion','/pricelist','/before-after/']){
 await page.goto(base+path);const state=await page.evaluate(()=>({h1:document.querySelector('h1')?.textContent,text:document.body.innerText,links:[...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')),price:document.querySelector('.product-detail-copy>strong')?.textContent}));assert(!/Loading/.test(state.text));if(path.startsWith('/products/')){const selected=path.includes(kalahari.slug || kalahari.id)?kalahari:product;assert.equal(state.price,`R${Number(selected.price).toFixed(2)}`);}initial.push({path,...state});
}
await nojs.close();
// Verified receipt is required; browser refresh must not create another purchase event.
const purchase=await browser.newContext();const pp=await purchase.newPage();await pp.addInitScript(()=>{window.gtag=(...args)=>(window.TEST_EVENTS ||= []).push(args)});
await pp.route('**/.netlify/functions/order-receipt**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({status:'paid',transaction_id:'ISOLATED-TEST',currency:'ZAR',value:265,shipping:0,items:[{item_id:kalahari.id,item_name:kalahari.name,price:265,quantity:1}]})}));
await pp.goto(base+'/payment-success?order=ISOLATED-TEST&token=isolated',{waitUntil:'networkidle'});assert.equal(await pp.evaluate(()=>(window.TEST_EVENTS || []).filter(e=>e[1]==='purchase').length),1);await pp.reload({waitUntil:'networkidle'});assert.equal(await pp.evaluate(()=>(window.TEST_EVENTS || []).filter(e=>e[1]==='purchase').length),0);
// Isolated GA4 journey uses an intercepted checkout response; no provider request.
const analytics=await browser.newContext();const ap=await analytics.newPage();
await ap.addInitScript(()=>{window.gtag=(...event)=>{const history=JSON.parse(localStorage.getItem("isolatedGa4") || "[]");history.push(event);localStorage.setItem("isolatedGa4",JSON.stringify(history));};});
await ap.route('**/.netlify/functions/ikhokha-checkout',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({paymentUrl:base+'/payment-cancelled',orderNumber:'ISOLATED-NO-ORDER',testMode:true})}));
await ap.goto(base+'/shop',{waitUntil:'networkidle'});await ap.locator(`a[href="/products/${kalahari.slug || kalahari.id}"]`).first().click();await ap.waitForLoadState('networkidle');await ap.locator('[data-product-detail-cart]').click();
await ap.goto(base+'/cart',{waitUntil:'networkidle'});await ap.locator('[name=name]').fill('Isolated Customer');await ap.locator('[name=email]').fill('isolated@example.invalid');await ap.locator('[name=phone]').fill('0820000000');
await ap.locator('[data-cart-ikhokha-checkout]').click();await ap.waitForURL('**/payment-cancelled');
const ga4=await ap.evaluate(()=>JSON.parse(localStorage.getItem('isolatedGa4') || '[]'));const names=ga4.filter(e=>e[0]==='event').map(e=>e[1]);
for(const event of ['view_item_list','select_item','view_item','add_to_cart','view_cart','begin_checkout','add_shipping_info','add_payment_info'])assert(names.includes(event),`Missing GA4 ${event}`);
assert(!JSON.stringify(ga4).includes('isolated@example.invalid'));assert(!JSON.stringify(ga4).includes('0820000000'));assert(!JSON.stringify(ga4).includes('Isolated Customer'));
writeFileSync(`${out}/ga4-browser-events.json`,JSON.stringify(ga4,null,2));await analytics.close();
const unverified=await browser.newContext();const up=await unverified.newPage();await up.addInitScript(()=>{window.gtag=(...args)=>(window.TEST_EVENTS ||= []).push(args)});
await up.route('**/.netlify/functions/order-receipt**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({status:'pending'})}));await up.goto(base+'/payment-success?order=ISOLATED-PENDING&token=isolated',{waitUntil:'load'});await up.waitForTimeout(500);assert.equal(await up.evaluate(()=>(window.TEST_EVENTS || []).filter(e=>e[1]==='purchase').length),0);await unverified.close();
assert.equal(errors.length,0,JSON.stringify(errors));writeFileSync(`${out}/responsive-results.json`,JSON.stringify(results,null,2));writeFileSync(`${out}/initial-html-evidence.json`,JSON.stringify(initial,null,2));writeFileSync(`${out}/browser-regressions.json`,JSON.stringify({pageErrors:errors,purchaseReceiptRequired:true,purchaseRefreshDeduplicated:true,widths:[320,375,390,430,1024,1280]},null,2));await browser.close();console.log(`Phase 1 browser regressions passed: ${results.length} responsive/journey checks, initial HTML and purchase deduplication.`);
