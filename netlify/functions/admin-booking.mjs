import { BOOKINGS_KEY, connectBlobContext, json, newId, parseJson, readList, writeList } from "./_admin-shared.mjs";

export const handler = async (event) => {
  connectBlobContext(event);
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });

  const body = parseJson(event);
  const booking = {
    id: newId("booking"),
    createdAt: new Date().toISOString(),
    status: "New",
    name: String(body.name || body.clientName || "").trim(),
    phone: String(body.phone || body.mobile || "").trim(),
    email: String(body.email || "").trim(),
    treatment: String(body.treatment || body.service || "").trim(),
    preferredDate: String(body.preferredDate || body.date || "").trim(),
    preferredTime: String(body.preferredTime || body.time || "").trim(),
    notes: String(body.notes || body.message || "").trim(),
  };

  const bookings = await readList(BOOKINGS_KEY);
  bookings.unshift(booking);
  await writeList(BOOKINGS_KEY, bookings.slice(0, 500));

  return json(200, { ok: true, bookingId: booking.id });
};
