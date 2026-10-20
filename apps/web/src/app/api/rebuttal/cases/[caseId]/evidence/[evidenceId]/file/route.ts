import { NextResponse } from "next/server";
import { apiFetch } from "../../../../../_lib";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ caseId: string; evidenceId: string }> },
) {
  const { caseId, evidenceId } = await params;
  try {
    const response = await apiFetch(
      `/cases/${encodeURIComponent(caseId)}/evidence/${encodeURIComponent(evidenceId)}/file`,
      {
        headers: { Accept: "application/pdf,image/png,image/jpeg,image/webp" },
      },
    );
    if (!response.ok) {
      return NextResponse.json(await response.json().catch(() => ({ error: "evidence unavailable" })), {
        status: response.status,
      });
    }
    return new NextResponse(await response.arrayBuffer(), {
      status: 200,
      headers: { "content-type": response.headers.get("content-type") ?? "application/octet-stream" },
    });
  } catch {
    return NextResponse.json({ error: "API unavailable" }, { status: 503 });
  }
}
