import { StoreProductListing } from "@rebuttal/core";
import { NextResponse } from "next/server";
import { createCatalog, PublishListingInput } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { authorize, json, notFound } from "@/lib/responses";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const denied = authorize(request);
  if (denied) return denied;
  const { id } = await context.params;
  const product = await createCatalog(getDb()).product(id);
  return product ? json(StoreProductListing, product) : notFound("product");
}

export async function PATCH(request: Request, context: Context) {
  const denied = authorize(request);
  if (denied) return denied;
  const parsed = PublishListingInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "invalid listing", issues: parsed.error.issues }, { status: 400 });
  const { id } = await context.params;
  const catalog = createCatalog(getDb());
  if (!(await catalog.product(id))) return notFound("product");
  return json(StoreProductListing, await catalog.publish(id, parsed.data));
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { Allow: "GET, PATCH, OPTIONS" } });
}
