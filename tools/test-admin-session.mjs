import assert from "node:assert/strict";
import { SESSION_MAX_AGE, createSessionCookie, requireSession } from "../netlify/functions/_admin-shared.mjs";
import { handler } from "../netlify/functions/admin-api.mjs";

process.env.ADMIN_SESSION_SECRET = "test-only-admin-session-secret-long-enough";
const originalNow = Date.now;
const issuedAt = 1_800_000_000_000;
Date.now = () => issuedAt;

try {
  const cookie = createSessionCookie("admin").split(";", 1)[0];
  const event = { headers: { cookie } };
  assert.equal(requireSession(event)?.username, "admin");

  Date.now = () => issuedAt + SESSION_MAX_AGE * 1000 + 1;
  assert.equal(requireSession(event), null, "expired sessions must remain blocked");

  Date.now = () => issuedAt + 60_000;
  const refreshed = await handler({ httpMethod: "POST", headers: { cookie }, queryStringParameters: { action: "refresh-session" }, body: "{}" });
  assert.equal(refreshed.statusCode, 200);
  assert.match(refreshed.headers["Set-Cookie"], /^lullubelle_admin=/, "refresh must rotate the cookie");

  Date.now = () => issuedAt + SESSION_MAX_AGE * 1000 + 1;
  const rejected = await handler({ httpMethod: "POST", headers: { cookie }, queryStringParameters: { action: "refresh-session" }, body: "{}" });
  assert.equal(rejected.statusCode, 401, "expired sessions must not be refreshable");
  assert.equal(JSON.parse(rejected.body).message, "Your admin session has expired. Please sign in again.");
} finally {
  Date.now = originalNow;
}

console.log("Admin session refresh and expiry tests passed.");
