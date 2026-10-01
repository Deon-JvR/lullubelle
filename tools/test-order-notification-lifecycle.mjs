// Exercises the actual signed checkout callback with isolated persistence and email.
// No provider calls, production Blob access, charges or live email are permitted.
import vm from 'node:vm';
import fs from 'node:fs';
import{pathToFileURL}from'node:url';
import{createHmac}from'node:crypto';
import{notifyPaidOrder}from'../netlify/functions/_order-notification.mjs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../netlify/functions',import.meta.url));
const results=[];

for(const version of['release'])for(const stale of[false,true])for(const emailFailure of[false,true]){
 let orders=[{id:'isolated-lag',orderNumber:'ISOLATED-LAG',externalTransactionID:'ISOLATED-LAG',ikhokhaPaylinkId:'isolated-link',newOrderNotificationVersion:1,paymentStatus:'Pending',total:100,products:[{name:'Example',price:100,quantity:1}],customer:{}}];
const pending=structuredClone(orders);
let reads=0,sends=0,attempts=0,notificationCalls=[];
const records=new Map();

 const deps={messageOptions:{to:'isolated@example.invalid',from:'isolated@example.invalid'},create:async(k,v)=>{if(records.has(k))return{modified:false};
records.set(k,{value:v,etag:'1'});
return{modified:true,etag:'1'};
},read:async k=>structuredClone(records.get(k)||{value:null,etag:''}),update:async(k,v,e)=>{if(records.get(k).etag!==e)throw new Error('CAS conflict');
const etag=String(Number(e)+1);
records.set(k,{value:structuredClone(v),etag});
return{modified:true,etag};
},send:async()=>{attempts++;
if(emailFailure)throw Object.assign(new Error('Isolated email failure'),{code:'transport',ambiguous:true});
sends++;
return{id:'fake'};
}};

 const ctx=vm.createContext({process:{env:{IKHOKHA_API_KEY:'isolated-app',IKHOKHA_API_SECRET:'isolated-secret'}},Buffer,URL,URLSearchParams,console:{info(){},warn(){},error(){}},Date,AbortSignal,setTimeout,clearTimeout,fetch:async()=>{throw new Error('Network disabled');
}});

 const shared={ORDERS_KEY:'orders',connectBlobContext(){},createRecord:deps.create,json:(statusCode,data)=>({statusCode,body:JSON.stringify(data)}),mutateList:async(_key,mutator)=>{orders=structuredClone(mutator(structuredClone(orders)));
return structuredClone(orders);
},newId:()=> 'isolated',parseJson:event=>JSON.parse(event.body),readContent:async()=>({products:[]}),readList:async()=>{reads++;
return structuredClone(stale && reads>1 ? pending:orders);
},readRecord:deps.read,updateRecord:deps.update,writeList:async()=>{throw new Error('Unexpected writeList');
}};

 const source=fs.readFileSync(root+'/ikhokha-checkout.mjs','utf8');
const m=new vm.SourceTextModule(source,{context:ctx});

 await m.link(async spec=>{let values;
if(spec==='./_admin-shared.mjs')values=shared;
else if(spec==='./_order-notification.mjs')values={notifyPaidOrder:async o=>{notificationCalls.push(o.paymentStatus);
return notifyPaidOrder(o,deps);
}};
else values=await import(spec.startsWith('.')?pathToFileURL(root+'/'+spec).href:spec);
const names=Object.keys(values);
return new vm.SyntheticModule(names,function(){for(const name of names)this.setExport(name,values[name]);
},{context:ctx});
});
await m.evaluate();

 const path='/.netlify/functions/ikhokha-checkout';
const body=JSON.stringify({externalTransactionID:'ISOLATED-LAG',paylinkID:'isolated-link',status:'SUCCESS',responseCode:'00',amount:10000,currency:'ZAR',transactionID:'isolated-transaction'});
const signature=createHmac('sha256','isolated-secret').update(m.namespace.escapeIkhokhaSignatureString(path+body)).digest('hex');
const event={httpMethod:'POST',path,headers:{'content-type':'application/json','ik-appid':'isolated-app','ik-sign':signature},queryStringParameters:{action:'confirm'},body};
const pendingBody=JSON.stringify({externalTransactionID:'ISOLATED-LAG',paylinkID:'isolated-link',status:'PENDING',amount:10000,currency:'ZAR'});
const pendingSign=createHmac('sha256','isolated-secret').update(m.namespace.escapeIkhokhaSignatureString(path+pendingBody)).digest('hex');
const pendingResponse=await m.namespace.handler({...event,body:pendingBody,headers:{...event.headers,'ik-sign':pendingSign}});
assert.equal(pendingResponse.statusCode,200);
assert.equal(JSON.parse(pendingResponse.body).paymentStatus,'Pending');
assert.equal(orders[0].paymentStatus,'Pending');
assert.equal(attempts,0);
assert.equal(records.size,0);
reads=0;

const response=await m.namespace.handler(event);
const duplicate=await m.namespace.handler(event);

 assert.equal(response.statusCode,200);
assert.equal(duplicate.statusCode,200);
assert.equal(orders[0].paymentStatus,'Paid');
assert(notificationCalls.every(s=>s==='Paid'));
assert(attempts>=1,'Committed PAID must trigger notification despite stale reads');
assert.equal(records.size,1);
assert.equal(sends,emailFailure?0:1);
assert.equal((await notifyPaidOrder({...orders[0],paymentStatus:'Pending'},deps)).state,'ineligible');
assert.equal(records.size,1,'Pending state creates no PAID delivery record');
if(emailFailure){assert.equal([...records.values()][0].value.state,'failed','Email delivery failure is persisted without rolling back payment');
deps.send=async()=>{sends++;
return{id:'retry-success'}};
assert.equal((await notifyPaidOrder(orders[0],deps)).state,'sent');
await notifyPaidOrder(orders[0],deps);
assert.equal(sends,1);
}assert.equal(orders[0].paymentStatus,'Paid');

 results.push({version,simulatedEmailFailure:emailFailure,stalePostCommitRead:stale,callbackStatus:response.statusCode,durablePaymentStatus:orders[0].paymentStatus,notificationStatusesReceived:notificationCalls,intendedFakeEmails:sends,transportAttempts:attempts,duplicateCallbackStatus:duplicate.statusCode,notificationStates:[...records.values()].map(r=>r.value.state),durableNotificationRecords:records.size,recoveredEmailFailure:emailFailure,paidNotificationFromCommittedOrder:true,immediateNotificationTriggerRequirement:attempts>=1?'PASS':'FAIL',realOrders:0,realCharges:0,realEmails:0,productionStoreAccess:false});

}
if(process.env.PHASE1_EVIDENCE_DIR){fs.mkdirSync(process.env.PHASE1_EVIDENCE_DIR,{recursive:true});
fs.writeFileSync(process.env.PHASE1_EVIDENCE_DIR+'/payment-notification-lifecycle.json',JSON.stringify(results,null,2));
}console.log('PASS: 4 signed-callback scenarios; PAID/pending; stale post-commit reads; callback/notification retries; deduplication; isolated email failure and recovery. No real network/storage/email/payment.');
