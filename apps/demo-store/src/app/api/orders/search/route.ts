import { StoreOrder } from "@rebuttal/connectors/store/schema";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { authorize, invalidQuery, json } from "@/lib/responses";
import { createStoreRecords } from "@/lib/store-records";

const Query = z.object({
  totalCents: z.coerce.number().int().nonnegative(),
  currency: z.string().length(3),
  placedAt: z.iso.datetime({ offset: true }),
  sku: z.string().min(1).optional(),
});

export async function GET(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  const parsed = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return invalidQuery(parsed.error.issues);
  return json(z.array(StoreOrder), await createStoreRecords(getDb()).searchOrders(parsed.data));
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { Allow: "GET, OPTIONS" } });
}
