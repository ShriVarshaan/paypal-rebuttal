import { StoreOrder } from "@rebuttal/connectors/store/schema";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { authorize, invalidQuery, json, notFound } from "@/lib/responses";
import { createStoreRecords } from "@/lib/store-records";

const Query = z
  .object({
    invoice: z.string().trim().min(1).optional(),
    capture: z.string().trim().min(1).optional(),
    paypalOrder: z.string().trim().min(1).optional(),
  })
  .refine((query) => query.invoice || query.capture || query.paypalOrder, {
    message: "provide invoice, capture, or paypalOrder",
  });

export async function GET(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const parsed = Query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return invalidQuery(parsed.error.issues);

  const row = await createStoreRecords(getDb()).findOrder({
    invoiceNumber: parsed.data.invoice,
    captureId: parsed.data.capture,
    paypalOrderId: parsed.data.paypalOrder,
  });
  return row ? json(StoreOrder, row) : notFound("order");
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { Allow: "GET, OPTIONS" } });
}
