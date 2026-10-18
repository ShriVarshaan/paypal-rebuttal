import { describe, expect, it } from "vitest";
import { TokenProvider } from "./auth.js";
import { silentLogger } from "./logger.js";
import { fakeFetch, json, tokenResponse } from "./testing/fake-fetch.js";

const base = {
  clientId: "id",
  clientSecret: "secret",
  baseUrl: "https://api-m.sandbox.paypal.com",
  log: silentLogger,
};

describe("TokenProvider", () => {
  it("fetches once and serves the cached token", async () => {
    const f = fakeFetch([]);
    const tokens = new TokenProvider({ ...base, fetch: f.fetch });
    expect(await tokens.getToken()).toBe("tok-1");
    expect(await tokens.getToken()).toBe("tok-1");
    expect(f.tokenRequests).toHaveLength(1);
    const req = f.tokenRequests[0]!;
    expect(req.method).toBe("POST");
    expect(req.headers["authorization"]).toBe(`Basic ${Buffer.from("id:secret").toString("base64")}`);
    expect(req.body).toBe("grant_type=client_credentials");
  });

  it("deduplicates concurrent refreshes into one token request", async () => {
    let n = 0;
    const f = fakeFetch([], async () => {
      await new Promise((r) => setTimeout(r, 10));
      return tokenResponse(`tok-${++n}`);
    });
    const tokens = new TokenProvider({ ...base, fetch: f.fetch });
    const results = await Promise.all(Array.from({ length: 10 }, () => tokens.getToken()));
    expect(new Set(results)).toEqual(new Set(["tok-1"]));
    expect(f.tokenRequests).toHaveLength(1);
  });

  it("refreshes 60s before expires_in", async () => {
    let now = 0;
    let n = 0;
    const f = fakeFetch([], () => tokenResponse(`tok-${++n}`, 3600));
    const tokens = new TokenProvider({ ...base, fetch: f.fetch, now: () => now });
    await tokens.getToken();
    now = (3600 - 61) * 1000;
    expect(await tokens.getToken()).toBe("tok-1");
    now = (3600 - 59) * 1000;
    expect(await tokens.getToken()).toBe("tok-2");
    expect(f.tokenRequests).toHaveLength(2);
  });

  it("invalidate() forces a new token", async () => {
    let n = 0;
    const f = fakeFetch([], () => tokenResponse(`tok-${++n}`));
    const tokens = new TokenProvider({ ...base, fetch: f.fetch });
    await tokens.getToken();
    tokens.invalidate();
    expect(await tokens.getToken()).toBe("tok-2");
  });

  it("surfaces auth failures as PayPalError and lets a later call retry", async () => {
    let fail = true;
    const f = fakeFetch([], () =>
      fail
        ? json(401, { error: "invalid_client", error_description: "Client Authentication failed" })
        : tokenResponse(),
    );
    const tokens = new TokenProvider({ ...base, fetch: f.fetch });
    await expect(tokens.getToken()).rejects.toMatchObject({ status: 401, name: "invalid_client" });
    fail = false;
    expect(await tokens.getToken()).toBe("tok-1");
  });
});
