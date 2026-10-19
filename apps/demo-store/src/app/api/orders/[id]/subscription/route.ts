import { StoreSubscription } from "@rebuttal/connectors/store/schema";
import { getDb } from "@/lib/db";
import { authorize, json, notFound } from "@/lib/responses";
import { createStoreRecords } from "@/lib/store-records";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = authorize(request);
  if (denied) return denied;
  const { id } = await params;
  const records = createStoreRecords(getDb());
  if (!(await records.orderExists(id))) return notFound("order");
  const subscription = await records.subscription(id);
  return subscription ? json(StoreSubscription, subscription) : notFound("subscription");
}
