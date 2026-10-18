// Record a real sandbox payload into fixtures/, scrubbed of buyer emails, names and streets.
//   pnpm tsx --env-file=.env scripts/record-fixture.ts dispute PP-D-12345 not-received
//   pnpm tsx --env-file=.env scripts/record-fixture.ts capture 3VK13355SM0012345
//   pnpm tsx --env-file=.env scripts/record-fixture.ts order 5O190127TN364715T
//   pnpm tsx --env-file=.env scripts/record-fixture.ts list
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPayPalClient, findRepoRoot, scrubPayload } from "@rebuttal/paypal";

const [kind, id, name] = process.argv.slice(2);
const client = createPayPalClient({ simulator: false, disputesVia: "rest" });
const dir = join(findRepoRoot(), "fixtures", "paypal");
mkdirSync(dir, { recursive: true });

let payload: unknown;
let file: string;
switch (kind) {
  case "dispute":
    payload = await client.disputes.show(id!);
    file = `dispute-${name ?? id}.json`;
    break;
  case "capture":
    payload = await client.payments.getCapture(id!);
    file = `capture-${id}.json`;
    break;
  case "order":
    payload = await client.orders.get(id!);
    file = `order-${id}.json`;
    break;
  case "list":
    payload = await client.disputes.list({ page_size: 50 });
    file = "disputes-list.json";
    break;
  default:
    console.error("usage: record-fixture.ts dispute <id> [name] | capture <id> | order <id> | list");
    process.exit(1);
}

writeFileSync(join(dir, file), JSON.stringify(scrubPayload(payload), null, 2) + "\n");
console.log(`wrote fixtures/paypal/${file} (scrubbed; review before committing)`);
