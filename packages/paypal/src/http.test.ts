import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TokenProvider } from "./auth.js";
import { PayPalError, PayPalResponseValidationError } from "./errors.js";
import { HttpClient, MAX_ATTEMPTS, parseRetryAfter } from "./http.js";
import type { Logger } from "./logger.js";
import { silentLogger } from "./logger.js";
import { fakeFetch, json, tokenResponse } from "./testing/fake-fetch.js";

const BASE = "https://api-m.sandbox.paypal.com";

function setup(
  responders: Parameters<typeof fakeFetch>[0],
  opts: { log?: Logger; token?: Parameters<typeof fakeFetch>[1] } = {},
) {
  const f = fakeFetch(responders, opts.token);
  const sleeps: number[] = [];
  const log = opts.log ?? silentLogger;
  const tokens = new TokenProvider({ clientId: "id", clientSecret: "s", baseUrl: BASE, fetch: f.fetch, log });
  const http = new HttpClient({
    baseUrl: BASE,
    tokens,
    log,
    fetch: f.fetch,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0.5,
  });
  return { http, f, sleeps };
}

const Ok = z.object({ ok: z.boolean() });

describe("HttpClient", () => {
  it("retries a 429 and succeeds, honouring Retry-After", async () => {
    const { http, f, sleeps } = setup([
      () => json(429, { name: "RATE_LIMIT_REACHED" }, { "retry-after": "2" }),
      () => json(200, { ok: true }),
    ]);
    await expect(http.request({ method: "GET", path: "/v1/x", schema: Ok })).resolves.toEqual({ ok: true });
    expect(f.requests).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
  });

  it("does not retry a 400 and parses the PayPal error body", async () => {
    const { http, f } = setup([
      () =>
        json(400, {
          name: "INVALID_REQUEST",
          message: "Request is not well-formed",
          debug_id: "abc123",
          details: [{ field: "/offer_type", issue: "INVALID_PARAMETER_VALUE" }],
        }),
    ]);
    const err = await http.request({ method: "GET", path: "/v1/x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err).toMatchObject({
      status: 400,
      name: "INVALID_REQUEST",
      message: "Request is not well-formed",
      debugId: "abc123",
      issue: "INVALID_PARAMETER_VALUE",
      retryable: false,
    });
    expect(f.requests).toHaveLength(1);
  });

  it(`gives up after ${MAX_ATTEMPTS} attempts with exponential backoff`, async () => {
    const { http, f, sleeps } = setup(Array.from({ length: MAX_ATTEMPTS }, () => () => json(503, {})));
    await expect(http.request({ method: "GET", path: "/v1/x" })).rejects.toMatchObject({ status: 503 });
    expect(f.requests).toHaveLength(MAX_ATTEMPTS);
    expect(sleeps).toEqual([188, 375, 750]); // ceiling 250/500/1000ms, jitter fixed at 0.5
  });

  it("retries network errors", async () => {
    const { http, f } = setup([
      () => {
        throw new TypeError("fetch failed");
      },
      () => json(200, { ok: true }),
    ]);
    await expect(http.request({ method: "GET", path: "/v1/x", schema: Ok })).resolves.toEqual({ ok: true });
    expect(f.requests).toHaveLength(2);
  });

  it("sends PayPal-Request-Id on POST and refuses a POST without one", async () => {
    const { http, f } = setup([() => json(201, { ok: true })]);
    await http.request({
      method: "POST",
      path: "/v1/x",
      idempotencyKey: "case1:dec1:MAKE_OFFER",
      json: { a: 1 },
      schema: Ok,
    });
    expect(f.requests[0]!.headers["paypal-request-id"]).toBe("case1:dec1:MAKE_OFFER");
    expect(f.requests[0]!.headers["content-type"]).toBe("application/json");
    expect(f.requests[0]!.body).toBe('{"a":1}');
    await expect(http.request({ method: "POST", path: "/v1/x", idempotencyKey: "" })).rejects.toThrow(
      /PayPal-Request-Id/,
    );
  });

  it("keeps the same PayPal-Request-Id across retries", async () => {
    const { http, f } = setup([() => json(500, {}), () => json(200, { ok: true })]);
    await http.request({ method: "POST", path: "/v1/x", idempotencyKey: "k1", json: {}, schema: Ok });
    expect(f.requests.map((r) => r.headers["paypal-request-id"])).toEqual(["k1", "k1"]);
  });

  it("refreshes an expired token once on 401", async () => {
    let n = 0;
    const { http, f } = setup(
      [() => json(401, { name: "AUTHENTICATION_FAILURE" }), () => json(200, { ok: true })],
      {
        token: () => tokenResponse(`tok-${++n}`),
      },
    );
    await expect(http.request({ method: "GET", path: "/v1/x", schema: Ok })).resolves.toEqual({ ok: true });
    expect(f.tokenRequests).toHaveLength(2);
    expect(f.requests.map((r) => r.headers["authorization"])).toEqual(["Bearer tok-1", "Bearer tok-2"]);
  });

  it("rejects a 2xx body that does not match the schema", async () => {
    const { http } = setup([() => json(200, { ok: "yes" })]);
    await expect(http.request({ method: "GET", path: "/v1/x", schema: Ok })).rejects.toBeInstanceOf(
      PayPalResponseValidationError,
    );
  });

  it("logs method, path, status and debug id but never the token", async () => {
    const lines: unknown[] = [];
    const log: Logger = { ...silentLogger, info: (o) => void lines.push(o) };
    const { http } = setup([() => json(200, { ok: true }, { "paypal-debug-id": "dbg-1" })], { log });
    await http.request({ method: "GET", path: "/v1/x", query: { page_size: 5 }, schema: Ok });
    const entry = lines.find((l) => (l as { path?: string }).path === "/v1/x");
    expect(entry).toMatchObject({ method: "GET", path: "/v1/x", status: 200, debugId: "dbg-1" });
    expect(JSON.stringify(lines)).not.toContain("tok-1");
  });

  it("parses Retry-After as seconds or an HTTP date", () => {
    expect(parseRetryAfter("3", 0)).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter("soon", 0)).toBeUndefined();
    expect(parseRetryAfter(null, 0)).toBeUndefined();
  });
});
