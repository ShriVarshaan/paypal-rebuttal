import { NextResponse } from "next/server";
import { apiFetch } from "../_lib";

/**
 * Server-side proxy for the api calls the browser may make beyond the validated reads in the
 * sibling routes. Only these method/path pairs pass; everything else is a 404, so the browser
 * can never reach an api route by accident. The api token is added here and never sent to
 * the client. Bodies stream through, which covers PDFs and the SSE event stream.
 */
const ID = "[A-Za-z0-9_-]{1,64}";
const ALLOWED: [string, RegExp][] = [
  ["POST", new RegExp(`^decisions/${ID}/(approve|reject|override|pack)$`)],
  ["PATCH", new RegExp(`^decisions/${ID}$`)],
  ["PUT", new RegExp(`^decisions/${ID}/narrative$`)],
  ["GET", new RegExp(`^packs/${ID}/file$`)],
  ["POST", new RegExp(`^cases/${ID}/(triage|buyer-message|messages)$`)],
  ["GET", /^policy$/],
  ["PUT", /^policy$/],
  ["GET", /^notifications$/],
  ["POST", new RegExp(`^notifications/(${ID}/read|read-all)$`)],
  ["GET", /^metrics\/(agents|summary)$/],
  ["GET", /^eval\/report$/],
  ["GET", /^events\/stream$/],
  ["GET", /^onboarding$/],
  ["POST", /^onboarding\/(paypal|store|policy|sync)$/],
];

const FORWARD_HEADERS = [
  "content-type",
  "content-disposition",
  "content-length",
  "cache-control",
  "x-total-count",
];

async function proxy(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  if (!ALLOWED.some(([method, pattern]) => method === request.method && pattern.test(path)))
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const search = new URL(request.url).search;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await apiFetch(`/${path}${search}`, {
      method: request.method,
      signal: request.signal,
      headers: {
        ...(hasBody ? { "content-type": "application/json" } : {}),
        ...(path === "events/stream" ? { accept: "text/event-stream" } : {}),
      },
      ...(hasBody ? { body: (await request.text()) || "{}" } : {}),
    });
  } catch {
    return NextResponse.json({ error: "API unavailable" }, { status: 503 });
  }
  const headers = new Headers();
  for (const name of FORWARD_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (path === "events/stream") {
    headers.set("cache-control", "no-cache, no-transform");
    headers.set("x-accel-buffering", "no");
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH };
