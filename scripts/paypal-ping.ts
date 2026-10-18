// Day 1 smoke test: get an OAuth token and list sandbox disputes with plain fetch.
//   pnpm paypal:ping
// An empty `items` array is fine. A 403 / PERMISSION_DENIED usually means the call
// isn't using your sandbox *business* app, or the app lacks the Disputes feature.

const base = (process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com").replace(/\/+$/, "");
const id = process.env.PAYPAL_CLIENT_ID;
const secret = process.env.PAYPAL_CLIENT_SECRET;
if (!id || !secret) {
  console.error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env first.");
  process.exit(1);
}
if (!base.includes("sandbox")) {
  console.error(`Refusing non-sandbox base URL ${base}`);
  process.exit(1);
}

const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
  method: "POST",
  headers: {
    Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: "grant_type=client_credentials",
});
const token = (await tokenRes.json()) as {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error_description?: string;
};
if (!tokenRes.ok || !token.access_token) {
  console.error(`Token request failed (${tokenRes.status}): ${token.error_description ?? "unknown error"}`);
  process.exit(1);
}
console.log(`token ok, expires in ${token.expires_in}s`);
console.log(`disputes scope granted: ${token.scope?.includes("disputes") ?? "unknown"}`);

const res = await fetch(`${base}/v1/customer/disputes?page_size=10`, {
  headers: { Authorization: `Bearer ${token.access_token}` },
});
console.log(`GET /v1/customer/disputes → ${res.status} (debug id ${res.headers.get("paypal-debug-id")})`);
console.log(JSON.stringify(await res.json(), null, 2));
process.exit(res.ok ? 0 : 1);
