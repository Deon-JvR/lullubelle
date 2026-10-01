import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRecord, readRecord, updateRecord } from "./_admin-shared.mjs";
const keyFor = order => `order-notification/${createHash('sha256').update(String(order.id || order.orderNumber)).digest('hex')}/paid-v1`;
const approvedRecipient = () => process.env.ORDER_NOTIFICATION_TO || JSON.parse(readFileSync('index.html','utf8').match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1]).email;
export const notificationMessage = (order, { to = approvedRecipient(), from = process.env.ORDER_NOTIFICATION_FROM } = {}) => ({
  to: [to], from,
  subject: `New Lullubelle Order — #${order.orderNumber} — PAID`,
  text: [
    `Order: ${order.orderNumber}`, `Placed: ${order.createdAt}`, `Paid: ${order.paidAt || order.paymentVerifiedAt}`,
    `Customer: ${order.customer?.name || ''}`, `Telephone: ${order.customer?.phone || ''}`, `Email: ${order.customer?.email || ''}`,
    '', ...(order.products || []).map(p => `${p.name} | ${p.quantity} × R${Number(p.price).toFixed(2)} | R${(Number(p.price)*Number(p.quantity)).toFixed(2)}`), '',
    `Subtotal: R${Number(order.subtotal || 0).toFixed(2)}`, `Discount: R${Number(order.discountAmount || 0).toFixed(2)}`,
    `Fulfilment: ${order.delivery?.label || order.deliveryMethod || order.delivery?.option || ''}`, `Shipping / collection: R${Number(order.deliveryFee || 0).toFixed(2)}`,
    ...(order.deliveryMethod === 'collection' ? [] : [`Delivery address: ${Object.values(order.address || {}).filter(Boolean).join(', ')}`]),
    `Total: R${Number(order.total).toFixed(2)}`, `Payment method: ${order.paymentProvider || 'iKhokha'}`, 'Payment status: PAID — verified server-side',
    `Notes: ${order.notes || order.customer?.notes || ''}`, 'Admin: https://www.lullubelle.co.za/admin/',
  ].join('\n'),
});
export const sendResend = async (message, idempotencyKey) => {
  if (!process.env.RESEND_API_KEY || !message.from || !message.to?.[0]) throw Object.assign(new Error('Email configuration missing'), { code:'configuration', ambiguous:false });
  let response;
  try { response = await fetch('https://api.resend.com/emails', { method:'POST', headers:{ Authorization:`Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type':'application/json', 'Idempotency-Key':idempotencyKey }, body:JSON.stringify(message), signal:AbortSignal.timeout(8000) }); }
  catch { throw Object.assign(new Error('Email transport unavailable'), { code:'transport', ambiguous:true }); }
  const result=await response.json().catch(()=>({}));
  if (!response.ok || !result.id) throw Object.assign(new Error('Email provider rejected request'), { code:`provider-${response.status}`, ambiguous:response.status >= 500 || response.ok });
  return {id:result.id};
};
// An order is already durable and Paid before this function runs. Email never controls payment.
export const notifyPaidOrder = async (order, deps = {}) => {
  if (order?.newOrderNotificationVersion !== 1 || order.paymentStatus !== 'Paid' || !order.paymentVerifiedAt) return {state:'ineligible'};
  const create=deps.create || createRecord, read=deps.read || readRecord, update=deps.update || updateRecord;
  const send=deps.send || sendResend, now=deps.now || Date.now;
  const key=keyFor(order);let state,etag;
  try {
    const initial={state:'pending', attempts:0, createdAt:new Date(now()).toISOString(), message:notificationMessage(order,deps.messageOptions), idempotencyKey:key};
    const created=await create(key,initial);
    // A new durable write supplies its own ETag. Claim it immediately without
    // waiting for eventual read visibility; retries still use CAS-protected reads.
    const record=created?.modified && created.etag ? {value:initial,etag:created.etag} : await read(key,{strong:false});state=record.value;etag=record.etag;
    if (!state || !etag) return {state:'unavailable'};
    if (state.state === 'sent' || state.state === 'manual-review') return {state:state.state};
    if (state.state === 'sending' && now() - Date.parse(state.lastAttemptAt) < 60000) return {state:'in-flight'};
    // Provider keys expire after 24 hours. Ambiguous attempts must not be resent after expiry.
    if (state.firstSendAt && now() - Date.parse(state.firstSendAt) > 23*60*60*1000 && state.ambiguous !== false) {
      await update(key,{...state,state:'manual-review',lastErrorCode:'idempotency-window-expired'},etag);
      return {state:'manual-review'};
    }
    const configured = deps.send || (process.env.RESEND_API_KEY && state.message.from);
    const claimed={...state,...(!state.firstSendAt ? {message:notificationMessage(order,deps.messageOptions)} : {}),state:'sending',attempts:state.attempts+1,lastAttemptAt:new Date(now()).toISOString(),...(configured && !state.firstSendAt ? {firstSendAt:new Date(now()).toISOString()} : {})};
    const claim=await update(key,claimed,etag);state=claimed;etag=claim.etag;
    const result=await send(state.message,state.idempotencyKey);
    await update(key,{...state,state:'sent',providerId:result.id,sentAt:new Date(now()).toISOString(),ambiguous:false},etag);
    return {state:'sent'};
  } catch (error) {
    // CAS conflicts leave the winning worker in charge. A failure cannot propagate into checkout.
    if (state && etag && state.state === 'sending') {
      try { await update(key,{...state,state:'failed',lastErrorCode:error.code || 'storage-or-delivery',ambiguous:error.ambiguous !== false},etag); } catch { /* lease/retry or manual review recovers */ }
    }
    return {state:'failed'};
  }
};

export const notificationStatus = async order => {
  const record=await readRecord(keyFor(order),{strong:false});const state=record.value;
  return {orderNumber:order.orderNumber,state:state?.state || "not-queued",attempts:state?.attempts || 0,sentAt:state?.sentAt || null,lastAttemptAt:state?.lastAttemptAt || null,lastErrorCode:state?.lastErrorCode || null};
};
