import { timingSafeEqual } from "node:crypto";
import { ORDERS_KEY, readList, json, connectBlobContext } from "./_admin-shared.mjs";
export const receiptFor = (orders, reference, token) => {
  const order=orders.find(o=>o.orderNumber===reference);
  const expected=Buffer.from(String(order?.analyticsAccessToken || ''));
  const provided=Buffer.from(String(token || ''));
  if (!expected.length || expected.length !== provided.length || !timingSafeEqual(expected,provided)) return null;
  if (order.paymentStatus !== 'Paid' || !order.paymentVerifiedAt) return {status:'pending'};
  return {status:'paid',transaction_id:order.orderNumber,currency:'ZAR',value:Number(order.total),shipping:Number(order.deliveryFee || 0),items:(order.products || []).map(p=>({item_id:/^online-skin-consultation/.test(p.id)?'online-skin-consultation':p.id,item_name:p.name,price:Number(p.price),quantity:Number(p.quantity)}))};
};
export const handler = async event => {
  if (event.httpMethod !== 'GET') return json(405,{error:'Method not allowed'},{Allow:'GET'});
  connectBlobContext(event);
  const q=event.queryStringParameters || {};
  const receipt=receiptFor(await readList(ORDERS_KEY),q.order,q.token);
  return json(receipt?200:404,receipt || {error:'Order not found'},{'X-Robots-Tag':'noindex','Referrer-Policy':'no-referrer'});
};
