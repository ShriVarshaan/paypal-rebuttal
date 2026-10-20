import { StoreProductListing } from "@rebuttal/core";
import { NextResponse } from "next/server";
import { CreateProductInput, createCatalog } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { authorize, json } from "@/lib/responses";

export async function POST(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  const parsed = CreateProductInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "invalid product", issues: parsed.error.issues }, { status: 400 });
  return json(StoreProductListing, await createCatalog(getDb()).create(parsed.data));
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { Allow: "POST, OPTIONS" } });
}
