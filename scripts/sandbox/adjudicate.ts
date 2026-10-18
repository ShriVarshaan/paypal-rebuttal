// Sandbox only: settle a dispute.
//   pnpm sandbox:adjudicate PP-D-12345 seller|buyer
import { arg, paypal, postSimWebhook, scriptKey } from "../lib.js";

const id = arg(0, "adjudicate.ts <disputeId> seller|buyer");
const side = arg(1, "adjudicate.ts <disputeId> seller|buyer");
if (side !== "seller" && side !== "buyer") {
  console.error("second argument must be seller or buyer");
  process.exit(1);
}
const client = paypal();
await client.disputes.adjudicate(
  id,
  side === "seller" ? "SELLER_FAVOR" : "BUYER_FAVOR",
  scriptKey("adjudicate", id),
);
const d = await client.disputes.show(id);
console.log(`${id}: status=${d.status} outcome=${d.dispute_outcome?.outcome_code ?? "-"}`);
await postSimWebhook(client, "CUSTOMER.DISPUTE.RESOLVED", d);
