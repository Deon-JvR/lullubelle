import { ORDERS_KEY, connectBlobContext, json, newId, parseJson, readList, writeList } from "./_admin-shared.mjs";

export const handler = async (event) => {
  connectBlobContext(event);
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });

  const body = parseJson(event);
  const order = {
    id: newId("order"),
    orderNumber: body.orderNumber || `LUL-${Date.now()}`,
    createdAt: new Date().toISOString(),
    customer: body.customer || {},
    products: Array.isArray(body.products) ? body.products : [],
    total: Number(body.total) || 0,
    paymentStatus: body.paymentStatus || "Pending",
    orderStatus: body.orderStatus || "New",
  };

  const orders = await readList(ORDERS_KEY);
  orders.unshift(order);
  await writeList(ORDERS_KEY, orders.slice(0, 500));

  return json(200, { ok: true, orderNumber: order.orderNumber });
};
