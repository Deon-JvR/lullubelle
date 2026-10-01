import {brotliCompressSync,gzipSync,constants} from "node:zlib";
import {reconcileContentImages} from "../netlify/functions/_product-image-reconciliation.mjs";
// Isolated review server: no Blob credentials, provider calls, orders or emails.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { productResponse } from '../netlify/functions/product-page.mjs';
import { shopResponse } from '../netlify/functions/shop-page.mjs';
import { sitemapResponse } from '../netlify/functions/sitemap.mjs';
import { renderContentPage } from '../netlify/functions/content-page.mjs';
import { publicContent } from '../netlify/functions/_public-catalogue.mjs';
const snapshot=process.env.PHASE1_CATALOGUE_SNAPSHOT;
if (!snapshot) throw new Error('Supply PHASE1_CATALOGUE_SNAPSHOT; never fetch production implicitly.');
const content=reconcileContentImages(JSON.parse(readFileSync(snapshot,'utf8')));
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.txt':'text/plain','.xml':'application/xml'};
createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');const event={path:url.pathname,httpMethod:req.method,queryStringParameters:Object.fromEntries(url.searchParams)};let result;
 if (process.env.PHASE1_STATIC_TESTS && !url.pathname.startsWith('/.netlify/functions/') && !url.pathname.startsWith('/products/')) {
  let file=resolve('.'+url.pathname);if(url.pathname.endsWith('/'))file=join(file,'index.html');if(!extname(file))file+='.html';
  result=existsSync(file)?{statusCode:200,body:readFileSync(file),headers:{'Content-Type':types[extname(file)] || 'text/html'}}:{statusCode:404,body:'Not found'};
 } else if (url.pathname.startsWith('/.netlify/functions/')) {
  if(url.pathname.endsWith('/admin-asset')) {
   const cache='/private/tmp/lullubelle-phase1-review/image-cache';const index=existsSync(cache+'/index.json')?JSON.parse(readFileSync(cache+'/index.json')):{};const entry=index[url.pathname+url.search];result=entry?{statusCode:200,body:readFileSync(cache+'/'+entry.file),headers:{'Content-Type':entry.type}}:{statusCode:404,body:'Image not cached'};
  } else if(url.pathname.endsWith('/admin-content'))result={statusCode:200,body:JSON.stringify(publicContent(content)),headers:{'Content-Type':'application/json'}};
  else result={statusCode:403,body:'Review server blocks persistence and payment endpoints'};
 } else if(/^\/products\/[^/]+$/.test(url.pathname)&&!existsSync(resolve('.'+url.pathname))) result=productResponse(event,content);
 else if(['/product','/product.html'].includes(url.pathname))result=productResponse(event,content);
 else if(url.pathname==='/shop'||url.pathname==='/shop.html'||url.pathname.startsWith('/shop/'))result=shopResponse(event,content);
 else if(url.pathname==='/sitemap.xml')result=sitemapResponse(content);
 else {
  const dynamic=renderContentPage(url.pathname,content);
  if(dynamic)result={statusCode:200,body:dynamic,headers:{'Content-Type':'text/html'}};
  else {
   let path=resolve('.'+decodeURIComponent(url.pathname));
   if(!path.startsWith(process.cwd()+'/')||/\/(?:\.git|\.env|Docs|reports|tools|netlify|node_modules)(?:\/|$)/i.test(path))result={statusCode:404,body:'Not found'};
   else {
    if(url.pathname.endsWith('/') && existsSync(join(path,'index.html')))path=join(path,'index.html');
    if(!extname(path)&&existsSync(path+'.html'))path+='.html';
    if(existsSync(path)&&extname(path))result={statusCode:200,body:readFileSync(path),headers:{'Content-Type':types[extname(path)] || 'application/octet-stream'}};
    else result={statusCode:404,body:'Not found'};
   }
  }
 }
 const headers=result.headers || {'Content-Type':'text/html'};let body=result.body;
 if (/text|json|xml|javascript/.test(headers['Content-Type'] || '') && body) { const br=(req.headers['accept-encoding'] || '').includes('br');body=br ? brotliCompressSync(Buffer.from(body),{params:{[constants.BROTLI_PARAM_QUALITY]:4}}) : gzipSync(Buffer.from(body));headers['Content-Encoding']=br?'br':'gzip'; }
 res.writeHead(result.statusCode,headers);res.end(body);
}).listen(Number(process.env.PHASE1_REVIEW_PORT || 4173),'127.0.0.1',()=>console.log('Isolated Phase 1 review server ready'));
