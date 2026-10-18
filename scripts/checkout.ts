// Day 1 (B): a tiny sandbox checkout so the buyer account can pay the seller, the first step
// to opening real sandbox disputes. See docs/sandbox-runbook.md.
//   pnpm checkout          → http://localhost:3005
// Orders v2 create + capture through @rebuttal/paypal's retrying, sandbox-only client.
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { HttpClient, TokenProvider, defaultLogger, payPalConfigFromEnv } from "@rebuttal/paypal";

/** The role doc's five payments, so the decision engine sees a spread of amounts. */
const PRESETS = [
  { name: "Phone case", amount: "12.00", digital: false },
  { name: "Digital recipe e-book", amount: "49.00", digital: true },
  { name: "Wireless headphones", amount: "85.00", digital: false },
  { name: "Waxed canvas jacket", amount: "150.00", digital: false },
  { name: "Walnut side table", amount: "400.00", digital: false },
];

const config = payPalConfigFromEnv();
const log = defaultLogger();
const tokens = new TokenProvider({ ...config, log });
const http = new HttpClient({ baseUrl: config.baseUrl, tokens, log });
const port = Number(process.env["CHECKOUT_PORT"] ?? 3005);

interface OrderLike {
  id: string;
  status: string;
  purchase_units?: { payments?: { captures?: { id: string; status: string }[] } }[];
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function send(res: ServerResponse, status: number, data: unknown, type = "application/json") {
  res.writeHead(status, { "content-type": type });
  res.end(type === "application/json" ? JSON.stringify(data) : String(data));
}

/** Amount "1.00".."10000.00" and a short item name: the only inputs that reach PayPal. */
function parseItem(b: Record<string, unknown>): { name: string; amount: string; digital: boolean } | null {
  const name = typeof b["name"] === "string" ? b["name"].trim().slice(0, 127) : "";
  const amount = typeof b["amount"] === "string" ? b["amount"].trim() : "";
  if (!name || !/^\d{1,5}(\.\d{2})?$/.test(amount)) return null;
  const n = Number(amount);
  if (n < 1 || n > 10_000) return null;
  return { name, amount: n.toFixed(2), digital: b["digital"] === true };
}

const page = () => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo checkout</title>
<style>
:root{--bg:#fff;--fg:#1a1d21;--line:#d9dde2;--muted:#5d6670;--chip:#f1f3f5}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--fg:#e6e8eb;--line:#2f353c;--muted:#9aa3ad;--chip:#1d2126}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{max-width:520px;margin:0 auto;padding:24px 16px}
label{display:block;margin:12px 0 4px;font-weight:600}
input[type=text]{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit}
.presets{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 16px}
.presets button{border:1px solid var(--line);background:var(--chip);color:var(--fg);border-radius:999px;padding:4px 12px;font:inherit;cursor:pointer}
.muted{color:var(--muted)}#paypal{margin-top:20px}pre{white-space:pre-wrap;font-size:13px}
</style>
<script src="https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.clientId)}&currency=USD&intent=capture"></script>
</head><body><main>
<h1>Demo checkout (sandbox)</h1>
<p class="muted">Pay as the sandbox <strong>personal</strong> (buyer) account. Each capture prints the ids you need to add tracking and open a dispute.</p>
<div class="presets">${PRESETS.map((p, i) => `<button type="button" data-i="${i}">$${p.amount} · ${p.name}</button>`).join("")}</div>
<label for="name">Item</label><input id="name" type="text" value="${PRESETS[0]!.name}" maxlength="127">
<label for="amount">Amount (USD)</label><input id="amount" type="text" value="${PRESETS[0]!.amount}" inputmode="decimal">
<label><input id="digital" type="checkbox"> Digital goods (no shipping)</label>
<div id="paypal"></div>
<pre id="out"></pre>
<script>
const presets = ${JSON.stringify(PRESETS)};
const $ = (id) => document.getElementById(id);
document.querySelectorAll(".presets button").forEach((b) => b.addEventListener("click", () => {
  const p = presets[Number(b.dataset.i)];
  $("name").value = p.name; $("amount").value = p.amount; $("digital").checked = p.digital;
}));
paypal.Buttons({
  createOrder: () => fetch("/api/orders", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: $("name").value, amount: $("amount").value, digital: $("digital").checked }) })
    .then((r) => r.json()).then((o) => { if (!o.id) throw new Error(o.error || "order failed"); return o.id; }),
  onApprove: (data) => fetch("/api/orders/" + data.orderID + "/capture", { method: "POST" })
    .then((r) => r.json()).then((o) => { $("out").textContent = JSON.stringify(o, null, 2); }),
  onError: (err) => { $("out").textContent = "Error: " + err; },
}).render("#paypal");
</script>
</main></body></html>`;

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/")
      return send(res, 200, page(), "text/html; charset=utf-8");

    if (req.method === "POST" && url.pathname === "/api/orders") {
      const item = parseItem(await body(req));
      if (!item)
        return send(res, 400, { error: "name and an amount between 1.00 and 10000.00 are required" });
      const invoice = `INV-${Date.now()}`;
      const sku = `SKU-${item.name
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .slice(0, 30)}`;
      const money = { currency_code: "USD", value: item.amount };
      const order = await http.request<OrderLike>({
        method: "POST",
        path: "/v2/checkout/orders",
        idempotencyKey: `checkout:create:${randomUUID()}`,
        json: {
          intent: "CAPTURE",
          purchase_units: [
            {
              invoice_id: invoice,
              amount: { ...money, breakdown: { item_total: money } },
              items: [
                {
                  name: item.name,
                  sku,
                  quantity: "1",
                  unit_amount: money,
                  category: item.digital ? "DIGITAL_GOODS" : "PHYSICAL_GOODS",
                },
              ],
            },
          ],
          payment_source: {
            paypal: {
              experience_context: { shipping_preference: item.digital ? "NO_SHIPPING" : "GET_FROM_FILE" },
            },
          },
        },
      });
      console.log(`created order ${order.id} for ${item.name} $${item.amount} (${invoice})`);
      return send(res, 201, { id: order.id, invoice });
    }

    const capture = /^\/api\/orders\/([A-Z0-9]{1,64})\/capture$/.exec(url.pathname);
    if (req.method === "POST" && capture) {
      const orderId = capture[1]!;
      const order = await http.request<OrderLike>({
        method: "POST",
        path: `/v2/checkout/orders/${orderId}/capture`,
        idempotencyKey: `checkout:capture:${orderId}`,
        json: {},
      });
      const cap = order.purchase_units?.[0]?.payments?.captures?.[0];
      console.log(`captured order ${order.id} → capture ${cap?.id} (${cap?.status})`);
      return send(res, 200, {
        orderId: order.id,
        status: order.status,
        captureId: cap?.id ?? null,
        next: cap?.id
          ? `pnpm sandbox:add-tracking ${order.id} ${cap.id} EZ4000000004   # physical orders; then open a dispute as the buyer`
          : null,
      });
    }
    send(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    send(res, 502, { error: err instanceof Error ? err.message : String(err) });
  }
}).listen(port, () => console.log(`demo checkout on http://localhost:${port} (sandbox ${config.baseUrl})`));
