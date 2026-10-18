// Attach a tracking number to a sandbox order (Orders v2 /track), e.g. an EasyPost test code
// so the EasyPost connector returns a known status:
//   pnpm sandbox:add-tracking <orderId> <captureId> EZ4000000004 [USPS]
import { arg, paypal, scriptKey } from "../lib.js";

const usage = "add-tracking.ts <orderId> <captureId> <trackingNumber> [carrier]";
const orderId = arg(0, usage);
const captureId = arg(1, usage);
const trackingNumber = arg(2, usage);
const carrier = process.argv[5] ?? "USPS";

const client = paypal();
await client.orders.addTracking(
  orderId,
  { capture_id: captureId, tracking_number: trackingNumber, carrier, notify_payer: false },
  scriptKey("track", orderId),
);
const order = await client.orders.get(orderId);
console.log(
  `trackers on ${orderId}:`,
  order.purchase_units.flatMap((u) => u.shipping?.trackers ?? []).map((t) => t.id),
);
