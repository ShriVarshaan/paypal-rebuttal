// Drives one dispute through the whole lifecycle against a running api + worker:
//   require-evidence → (pipeline gathers, decides, files) → adjudicate → WON/LOST.
//   pnpm sandbox:lifecycle PP-D-12345 [seller|buyer]
// Works against the sandbox, or offline with SIMULATOR=1 (start `SIMULATOR=1 pnpm dev` first).
// Approving the decision is up to you (UI or POST /decisions/:id/approve) unless the policy
// engine auto-approves it.
import { createDb } from "@rebuttal/db";
import { arg, paypal, postSimWebhook, scriptKey } from "../lib.js";

const id = arg(0, "full-lifecycle.ts <disputeId> [seller|buyer]");
const side = process.argv[3] === "buyer" ? "BUYER_FAVOR" : "SELLER_FAVOR";
const client = paypal();
const db = createDb();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(label: string, states: string[], timeoutMs: number): Promise<string> {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    const c = await db.case.findUnique({ where: { paypalDisputeId: id }, select: { state: true } });
    const state = c?.state ?? "(no case yet)";
    if (state !== last) console.log(`  ${((Date.now() - started) / 1000).toFixed(0)}s  ${state}`);
    last = state;
    if (states.includes(state)) return state;
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for ${label}; case is ${last}`);
}

try {
  console.log(`1. require-evidence on ${id}`);
  await client.disputes.requireEvidence(id, "SELLER_EVIDENCE", scriptKey("require-evidence", id));
  await postSimWebhook(client, "CUSTOMER.DISPUTE.UPDATED", await client.disputes.show(id));

  console.log("2. waiting for the pipeline to respond (approve the decision if it asks)");
  const responded = await waitFor(
    "a filed response",
    ["FILED", "WAITING_PAYPAL", "OFFER_PENDING", "REFUNDED"],
    15 * 60_000,
  );
  if (responded === "REFUNDED") {
    console.log("pipeline accepted the claim; nothing to adjudicate");
  } else {
    console.log(`3. adjudicate ${side}`);
    await client.disputes.adjudicate(id, side, scriptKey("adjudicate", id));
    await postSimWebhook(client, "CUSTOMER.DISPUTE.RESOLVED", await client.disputes.show(id));
    console.log("4. waiting for the outcome");
    console.log(`done: ${await waitFor("the outcome", ["WON", "LOST", "REFUNDED"], 5 * 60_000)}`);
  }
} finally {
  await db.$disconnect();
}
