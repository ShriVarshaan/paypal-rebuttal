import { MerchantSummary } from "@rebuttal/core";
import { NextResponse } from "next/server";
import { apiFetch, forwardJson } from "../_lib";

export async function GET() {
  try {
    return await forwardJson(await apiFetch("/merchant"), MerchantSummary);
  } catch {
    return NextResponse.json({ error: "API unavailable" }, { status: 503 });
  }
}
