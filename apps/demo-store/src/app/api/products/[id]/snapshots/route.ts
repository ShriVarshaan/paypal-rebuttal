import { ListingSnapshot } from "@rebuttal/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createCatalog } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { authorize, json, notFound } from "@/lib/responses";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = authorize(request);
  if (denied) return denied;
  const parsedAt = z.iso.datetime({ offset: true }).safeParse(new URL(request.url).searchParams.get("at"));
  if (!parsedAt.success) {
    return NextResponse.json({ error: "at must be a valid ISO timestamp" }, { status: 400 });
  }
  const at = new Date(parsedAt.data);
  const { id } = await params;
  const snapshot = await createCatalog(getDb()).snapshotAsOf(id, at);
  return snapshot ? json(ListingSnapshot, snapshot) : notFound("listing snapshot");
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { Allow: "GET, OPTIONS" } });
}
