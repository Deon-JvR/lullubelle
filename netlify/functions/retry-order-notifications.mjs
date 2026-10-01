import { ORDERS_KEY, readList, connectBlobContext } from "./_admin-shared.mjs";
import { notifyPaidOrder } from "./_order-notification.mjs";
export const config = { schedule: "*/5 * * * *" };
export const handler = async event => {
  // Netlify scheduled events, never a browser-callable retry endpoint.
  let scheduled=false;try { scheduled=Boolean(JSON.parse(event?.body || "{}").next_run); } catch {}
  if (!scheduled) return {statusCode:404,body:''};
  connectBlobContext(event);
  const orders=(await readList(ORDERS_KEY)).filter(o=>o.newOrderNotificationVersion===1 && o.paymentStatus==='Paid' && o.paymentVerifiedAt);
  const started=Date.now();
  for (const order of orders) { if (Date.now()-started > 15000) break; await notifyPaidOrder(order); }
  return {statusCode:200,body:'Complete'};
};
