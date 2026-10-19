import { afterEach, describe, expect, it, vi } from "vitest";
import { storeApiAuthorized } from "./auth";

afterEach(() => vi.unstubAllEnvs());

describe("store API authorization", () => {
  it("allows tokenless access only outside production", () => {
    vi.stubEnv("STORE_API_TOKEN", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(storeApiAuthorized(new Request("http://store.test/api/orders/lookup"))).toBe(true);

    vi.stubEnv("NODE_ENV", "production");
    expect(storeApiAuthorized(new Request("http://store.test/api/orders/lookup"))).toBe(false);
  });

  it("requires the exact configured bearer token", () => {
    vi.stubEnv("STORE_API_TOKEN", "local-store-secret");
    vi.stubEnv("NODE_ENV", "development");
    expect(
      storeApiAuthorized(
        new Request("http://store.test/api/orders/lookup", {
          headers: { Authorization: "Bearer local-store-secret" },
        }),
      ),
    ).toBe(true);
    expect(
      storeApiAuthorized(
        new Request("http://store.test/api/orders/lookup", {
          headers: { Authorization: "Bearer wrong" },
        }),
      ),
    ).toBe(false);
  });
});
