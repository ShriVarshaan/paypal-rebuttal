// Simulator mode: open a new dispute from a fixture and POST its CREATED webhook to the api.
//   pnpm sim:dispute not-received [--due-in-hours 48]
//   pnpm sim:dispute list
// Fixtures: fixtures/paypal/dispute-<name>.json. Needs `SIMULATOR=1 pnpm dev` running.
import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DisputeSchema, createSimulatorClient, findRepoRoot } from "@rebuttal/paypal";
import { postSimWebhook } from "./lib.js";

const root = findRepoRoot();
const client = createSimulatorClient();
const name = process.argv[2];

if (!name || name === "list") {
  for (const d of Object.values(client.sim.state().disputes)) {
    console.log(
      `${d.dispute_id}  ${d.reason.padEnd(40)} ${d.status.padEnd(28)} due ${d.seller_response_due_date ?? "-"}`,
    );
  }
  if (!name) console.log("\nusage: sim:dispute <fixture-name> [--due-in-hours N] | list");
  process.exit(0);
}

const flag = process.argv.indexOf("--due-in-hours");
const dueInHours = flag > 0 ? Number(process.argv[flag + 1]) : 10 * 24;
const template = DisputeSchema.parse(
  JSON.parse(readFileSync(join(root, "fixtures", "paypal", `dispute-${name}.json`), "utf8")),
);

const now = new Date();
const id = `PP-D-${randomInt(100000, 999999)}`;
const dispute = client.sim.createDispute({
  ...template,
  dispute_id: id,
  create_time: now.toISOString(),
  update_time: now.toISOString(),
  seller_response_due_date: new Date(now.getTime() + dueInHours * 3600_000).toISOString(),
  messages: (template.messages ?? []).map((m) => ({ ...m, time_posted: now.toISOString() })),
  links: [],
});
console.log(`opened ${id} (${dispute.reason}), due in ${dueInHours}h`);
await postSimWebhook(client, "CUSTOMER.DISPUTE.CREATED", dispute);
