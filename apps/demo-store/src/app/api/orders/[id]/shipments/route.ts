import { StoreShipment } from "@rebuttal/connectors/store/schema";
import { NextResponse } from "next/server";
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
  return json(z.array(StoreShipment), await records.shipments(id));
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { Allow: "GET, OPTIONS" } });
}
