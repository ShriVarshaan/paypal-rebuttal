import { NextResponse } from "next/server";
import type { z } from "zod";

export function apiOrigin(): string {
  return (process.env["API_URL"] ?? "http://127.0.0.1:3001").replace(/\/$/, "");
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${apiOrigin()}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(process.env["API_TOKEN"] ? { Authorization: `Bearer ${process.env["API_TOKEN"]}` } : {}),
      ...init?.headers,
    },
  });
}

export async function forwardJson<T extends z.ZodType>(response: Response, schema: T): Promise<NextResponse> {
  const body = await response.json().catch(() => ({ error: "invalid API response" }));
  if (!response.ok) return NextResponse.json(body, { status: response.status });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid API response" }, { status: 502 });
  const headers = new Headers({ "content-type": "application/json" });
  const total = response.headers.get("x-total-count");
  if (total) headers.set("x-total-count", total);
  return new NextResponse(JSON.stringify(parsed.data), { status: 200, headers });
}
