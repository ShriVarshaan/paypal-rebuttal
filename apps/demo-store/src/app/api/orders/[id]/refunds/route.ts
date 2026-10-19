import { StoreRefund } from "@rebuttal/connectors/store/schema";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { authorize, json, notFound } from "@/lib/responses";
import { createStoreRecords } from "@/lib/store-records";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = authorize(request);
  if (denied) return denied;
  const { id } = await params;
  const records = createStoreRecords(getDb());
  if (!(await records.orderExists(id))) return notFound("order");
  return json(z.array(StoreRefund), await records.refunds(id));
}
