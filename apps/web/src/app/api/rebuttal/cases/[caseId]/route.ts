import { CaseDetail } from "@rebuttal/core";
import { NextResponse } from "next/server";
import { apiFetch, forwardJson } from "../../_lib";

export async function GET(_request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  try {
    return await forwardJson(await apiFetch(`/cases/${encodeURIComponent(caseId)}`), CaseDetail);
  } catch {
    return NextResponse.json({ error: "API unavailable" }, { status: 503 });
  }
}
