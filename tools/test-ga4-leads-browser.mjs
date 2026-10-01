// Isolated browser acceptance: real GA4 library may load, but every collection
// request and every write is intercepted. No live analytics/customer data is sent.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
const base=process.env.PHASE1_BASE_URL || 'http://127.0.0.1:4184';
const out=process.env.PHASE1_EVIDENCE_DIR || '/private/tmp/lullubelle-homepage-final-review';
const measurementId='G-7PG6BZR9QV';
const marker='ISOLATED_CUSTOMER_PII';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844}});
const collection=[],blockedWrites=[],pages=[];
await context.addInitScript(()=>{window.open=()=>null;window.addEventListener('beforeunload',()=>localStorage.setItem('isolatedGa4Previous',JSON.stringify((window.dataLayer || []).filter(e=>e&&(e[0]==='event'||e[0]==='config')).map(e=>Array.from(e)))));});
await context.route('**/*',async r=>{
 const request=r.request(),u=new URL(request.url());
 if(/google-analytics|google\.com.*collect/.test(u.href)){
  collection.push({url:u.href,body:request.postData() || ''});return r.abort();
 }
 if(!['GET','HEAD'].includes(request.method())){blockedWrites.push(u.pathname);return r.fulfill({status:204,body:''});}
 if(u.origin===new URL(base).origin && u.pathname==='/script.js')return r.fulfill({contentType:'text/javascript',body:readFileSync(new URL('../script.js',import.meta.url),'utf8')});
 if(u.origin===new URL(base).origin && u.pathname==='/public/catalogue-card.js'){
  const source=await(await fetch(base+u.pathname)).text();
  return r.fulfill({contentType:'text/javascript',body:'window.__SSRFeaturedCards=[...document.querySelectorAll("[data-featured-products] .home-product-card")];\n'+source});
 }
 if(u.origin!==new URL(base).origin && !(u.hostname==='www.googletagmanager.com' && u.pathname.startsWith('/gtag/')))return r.abort();
 return r.continue();
});
const page=await context.newPage();
const snapshot=async label=>{
 const data=await page.evaluate(()=>({events:(window.dataLayer || []).filter(e=>e && (e[0]==='event'||e[0]==='config')).map(e=>Array.from(e)),referrer:document.referrer}));
 pages.push({label,...data});return data;
};
await page.goto(base+`/?email=${marker}%40example.invalid&token=${marker}`,{waitUntil:'domcontentloaded',referer:'https://www.google.com/search?q=beauty+salon+centurion'});
await page.waitForFunction(()=>window.dataLayer?.some(e=>e && e[0]==='config'));
await page.waitForTimeout(4000);
assert(await page.evaluate(()=>window.__SSRFeaturedCards.length===8 && window.__SSRFeaturedCards.every((n,i)=>n===document.querySelectorAll('[data-featured-products] .home-product-card')[i])),'Homepage enhancement must reuse matching server-rendered cards');
assert.equal(await page.locator('[data-featured-products] img[loading=lazy]').count(),8);
await page.locator('[data-featured-products] [data-managed-cart-add]').first().click();
assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('lullubelleCart'))[0].quantity),1,'Binding SSR controls twice must not duplicate cart additions');
// Prevent external navigation/native phone/email handlers while retaining click propagation.
await page.evaluate(()=>{
 const first=(selector)=>document.querySelector(selector);
 for(const a of [first('a[href^="tel:"]'),first('a[href^="mailto:"]'),first('a[href*="book-appointment"]')]){
  if(!a)throw new Error('Missing contact/booking link');a.addEventListener('click',e=>e.preventDefault());a.click();
 }
 const wa=document.createElement('a');wa.href='https://wa.me/27825764219?text=ISOLATED_CUSTOMER_PII';wa.textContent='Isolated WhatsApp CTA';wa.addEventListener('click',e=>e.preventDefault());document.body.append(wa);wa.click();wa.remove();
});
const home=await snapshot('homepage');
const configs=home.events.filter(e=>e[0]==='config');assert.equal(configs.length,1);assert.equal(configs[0][1],measurementId);
assert.equal(configs[0][2].page_location,new URL(base).origin+'/');assert(!('page_referrer' in configs[0][2]),'Organic referrer must not be overridden');
assert(home.referrer.startsWith('https://www.google.com/'));
for(const name of ['view_item_list','add_to_cart','phone_click','email_click','whatsapp_click','booking_start'])assert(home.events.some(e=>e[0]==='event'&&e[1]===name),`Missing ${name}`);
await page.goto(base+'/book-appointment',{waitUntil:'domcontentloaded'});
await page.locator('[name=name]').fill(marker);
await page.locator('[name=mobile]').fill('0820000000');
await page.locator('[name=email]').fill(marker+'@example.invalid');
const service=page.locator('[name=service]');await service.selectOption({index:1});
await page.locator('[name=date]').fill('2026-10-15');await page.locator('[name=time]').fill('10:00');
await page.locator('[name=notes]').fill(marker);
await page.locator('[data-appointment-booking-form] button[type=submit]').click();
await page.waitForTimeout(4500);
const booking=await snapshot('booking preparation');
for(const name of ['booking_start','appointment_whatsapp_prepare'])assert(booking.events.some(e=>e[0]==='event'&&e[1]===name),`Missing ${name}`);
assert(!booking.events.some(e=>e[0]==='event'&&/booking_complete|booking_confirmed/.test(e[1])),'WhatsApp preparation is not confirmed booking');
await page.goto(base+'/nail-care-kit',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.dataLayer?.some(e=>e&&e[0]==='config'));
const enquiry=page.locator('a[href*="wa.me/"]').first();await enquiry.evaluate(a=>a.addEventListener('click',e=>e.preventDefault()));await enquiry.click();
const genuine=await snapshot('genuine Nail Care Kit enquiry CTA');assert(genuine.events.some(e=>e[0]==='event'&&e[1]==='whatsapp_click'));
await page.goto(base+'/online-consultations',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.dataLayer?.some(e=>e&&e[0]==='config'));await page.waitForTimeout(2500);
await page.locator('[name=name]').fill(marker);await page.locator('[name=date]').fill('2026-10-15');await page.locator('[name=time]').fill('10:00');await page.locator('[name=message]').fill(marker);
await Promise.all([page.waitForURL('**/cart.html'),page.locator('[data-consultation-cart-form] button[type=submit]').click()]);
const consultation=await page.evaluate(()=>JSON.parse(localStorage.getItem('isolatedGa4Previous') || '[]'));pages.push({label:'consultation preparation before cart navigation',events:consultation});
for(const name of ['online_consultation_cart_prepare','contact_form_submit','quote_request'])assert(consultation.some(e=>e[0]==='event'&&e[1]===name),`Missing ${name}`);
await snapshot('consultation cart');
const payloads=JSON.stringify({pages,collection});
for(const value of [marker,'0820000000','2026-10-15'])assert(!payloads.includes(value),`PII forwarded: ${value}`);
assert(collection.length>0,'Must inspect actual intended GA4 collection requests before aborting them');
assert(collection.some(r=>new URL(r.url).searchParams.get('tid')===measurementId));
assert(collection.some(r=>String(new URL(r.url).searchParams.get('dr')).startsWith('https://www.google.com/')),'Actual intended page-view payload must retain Google referrer');
mkdirSync(out,{recursive:true});
writeFileSync(out+'/ga4-lead-browser.json',JSON.stringify({measurementId,propertyReset:false,googleReferrerPreserved:true,queryPiiRemoved:true,collectionRequestsBlocked:collection.length,liveCollectionSent:0,blockedWritePaths:blockedWrites,ssrCardsReused:8,cartClickQuantity:1,bookingCompletionNotFabricated:true,pages,collection},null,2));
await browser.close();console.log('PASS: existing GA4 ID/referrer, query/lead PII exclusion, actual blocked collection payloads, lead triggers, SSR DOM reuse, single cart addition; no live tracking/write/email/payment.');
