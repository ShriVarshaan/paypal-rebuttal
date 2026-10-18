// Sandbox only: move a dispute to "waiting for seller evidence".
//   pnpm sandbox:require-evidence PP-D-12345 [seller|buyer]
import { arg, paypal, postSimWebhook, scriptKey } from "../lib.js";

const id = arg(0, "require-evidence.ts <disputeId> [seller|buyer]");
const who = process.argv[3] === "buyer" ? "BUYER_EVIDENCE" : "SELLER_EVIDENCE";
const client = paypal();
await client.disputes.requireEvidence(id, who, scriptKey("require-evidence", id));
const d = await client.disputes.show(id);
console.log(
  `${id}: status=${d.status} stage=${d.dispute_life_cycle_stage} seller_response_due_date=${d.seller_response_due_date ?? "-"}`,
);
await postSimWebhook(client, "CUSTOMER.DISPUTE.UPDATED", d);
