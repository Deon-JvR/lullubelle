import {
  BOOKINGS_KEY,
  ORDERS_KEY,
  assetStore,
  clearSessionCookie,
  createSessionCookie,
  json,
  newId,
  parseJson,
  readContent,
  readList,
  requireSession,
  verifyPassword,
  writeContent,
  writeList,
} from "./_admin-shared.mjs";

const requireAuth = (event) => {
  const session = requireSession(event);
  return session || null;
};

const saveUpload = async ({ filename, mimeType, base64 }) => {
  if (!base64) throw new Error("No image supplied");
  const extension = (filename || "image.webp").split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "webp";
  const key = `${Date.now()}-${newId("asset")}.${extension}`;
  const buffer = Buffer.from(base64.replace(/^data:[^,]+,/, ""), "base64");
  await assetStore().set(key, buffer, {
    metadata: {
      contentType: mimeType || "application/octet-stream",
      originalFilename: filename || key,
    },
  });
  return `/.netlify/functions/admin-asset?key=${encodeURIComponent(key)}`;
};

export const handler = async (event) => {
  const method = event.httpMethod;
  const action = event.queryStringParameters?.action || "";
  const body = parseJson(event);

  if (method === "POST" && action === "login") {
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const expectedUsername = process.env.ADMIN_USERNAME;
    const expectedHash = process.env.ADMIN_PASSWORD_HASH;
    const sessionSecret = process.env.ADMIN_SESSION_SECRET;

    if (!expectedUsername || !expectedHash || !sessionSecret) {
      return json(500, { error: "Admin environment variables are not configured." });
    }

    if (username !== expectedUsername || !verifyPassword(password, expectedHash)) {
      return json(401, { error: "Invalid admin login." });
    }

    return json(200, { ok: true, username }, { "Set-Cookie": createSessionCookie(username) });
  }

  if (method === "POST" && action === "logout") {
    return json(200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
  }

  const session = requireAuth(event);
  if (!session) return json(401, { error: "Admin login required." });

  if (method === "GET" && action === "me") {
    return json(200, { ok: true, username: session.username });
  }

  if (method === "GET" && action === "content") {
    return json(200, await readContent());
  }

  if (method === "PUT" && action === "content") {
    return json(200, await writeContent(body));
  }

  if (method === "POST" && action === "upload") {
    try {
      const url = await saveUpload(body);
      return json(200, { ok: true, url });
    } catch (error) {
      return json(400, { error: error.message || "Upload failed." });
    }
  }

  if (method === "GET" && action === "bookings") {
    return json(200, await readList(BOOKINGS_KEY));
  }

  if (method === "PUT" && action === "bookings") {
    await writeList(BOOKINGS_KEY, body.items || []);
    return json(200, { ok: true });
  }

  if (method === "GET" && action === "orders") {
    return json(200, await readList(ORDERS_KEY));
  }

  if (method === "PUT" && action === "orders") {
    await writeList(ORDERS_KEY, body.items || []);
    return json(200, { ok: true });
  }

  return json(404, { error: "Unknown admin action." });
};
