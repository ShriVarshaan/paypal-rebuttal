import { CaseQueueItem } from "@rebuttal/core";
import { NextResponse } from "next/server";
import { apiFetch, forwardJson } from "../_lib";

const allowed = new Set(["state", "reason", "q", "sort", "take", "skip", "needsApproval", "dueWithinHours"]);

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const query = new URLSearchParams();
  for (const [key, value] of incoming.searchParams) if (allowed.has(key)) query.set(key, value);
  try {
    return await forwardJson(await apiFetch(`/cases${query.size ? `?${query}` : ""}`), CaseQueueItem.array());
  } catch {
    return NextResponse.json({ error: "API unavailable" }, { status: 503 });
  }
}
