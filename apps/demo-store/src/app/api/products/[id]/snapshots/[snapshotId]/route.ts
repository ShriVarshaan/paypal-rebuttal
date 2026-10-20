import { ListingSnapshot } from "@rebuttal/core";
import { NextResponse } from "next/server";
import { createCatalog } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { authorize, json, notFound } from "@/lib/responses";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; snapshotId: string }> },
) {
  const denied = authorize(request);
  if (denied) return denied;
  const { id, snapshotId } = await params;
  const snapshot = await createCatalog(getDb()).snapshot(id, snapshotId);
  return snapshot ? json(ListingSnapshot, snapshot) : notFound("listing snapshot");
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { Allow: "GET, OPTIONS" } });
}
