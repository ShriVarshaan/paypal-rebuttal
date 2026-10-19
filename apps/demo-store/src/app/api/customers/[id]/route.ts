import { StoreCustomer } from "@rebuttal/connectors/store/schema";
import { getDb } from "@/lib/db";
import { authorize, json, notFound } from "@/lib/responses";
import { createStoreRecords } from "@/lib/store-records";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = authorize(request);
  if (denied) return denied;
  const { id } = await params;
  const customer = await createStoreRecords(getDb()).customer(id);
  return customer ? json(StoreCustomer, customer) : notFound("customer");
}
