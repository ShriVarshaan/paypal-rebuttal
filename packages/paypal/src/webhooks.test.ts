import { describe, expect, it } from "vitest";
import { TokenProvider } from "./auth.js";
import { HttpClient } from "./http.js";
import { silentLogger } from "./logger.js";
import { fakeFetch, json, noSleep } from "./testing/fake-fetch.js";
import { MissingWebhookHeadersError, buildVerifyBody, createWebhooksApi } from "./webhooks.js";

const headers = {
  "paypal-transmission-id": "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
  "paypal-transmission-time": "2026-10-21T10:00:00Z",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-1d93a270",
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-transmission-sig":
    "lmI95Jx3Y9nhR5SJWlHVIWpg4AgFk7n9bCHSRxbrd8A9zrhdu2rMyFrmz+Zjh3s3boXB07VXCXUZy/UFzUlnGJn0wDugt7FlSvdKeIJenLRemUxYCPVoEZzg9VFNqOa48gMkvF+XTpxBeUx/kWy6B5cp7GkT2+pOowfRK7OaynuxUoKW3JcMWw272VKjLTtTAShncla7tGF+55rxyt2KNZIIqxNMJ48RDZheGU5w1npu9dZHnPgTXB9iomeVRoD8O/jhRpnKsGrDschyNdkeh81BJJMH4Ctc6lnCCquoP/GzCzz33MMsNdid7vL/NIWaCsekQpW26FpWPi/tfj8nLA==",
};

describe("webhook signature verification", () => {
  it("splices the raw event bytes into the verify body", () => {
    const rawBody =
      '{"id":"WH-1","event_type":"CUSTOMER.DISPUTE.CREATED","resource":{"dispute_id":"PP-D-1","amount":1.10}}';
    const body = buildVerifyBody({ headers, rawBody, webhookId: "WEBHOOK-ID" });
    expect(body.endsWith(`"webhook_event":${rawBody}}`)).toBe(true);
    expect(JSON.parse(body)).toMatchObject({
      auth_algo: "SHA256withRSA",
      transmission_id: headers["paypal-transmission-id"],
      webhook_id: "WEBHOOK-ID",
      webhook_event: { id: "WH-1" },
    });
  });

  it("throws when a PayPal header is missing", () => {
    const { ["paypal-transmission-sig"]: _sig, ...partial } = headers;
    expect(() => buildVerifyBody({ headers: partial, rawBody: "{}", webhookId: "W" })).toThrow(
      MissingWebhookHeadersError,
    );
  });

  it("accepts only verification_status SUCCESS", async () => {
    const f = fakeFetch([
      () => json(200, { verification_status: "SUCCESS" }),
      () => json(200, { verification_status: "FAILURE" }),
    ]);
    const base = "https://api-m.sandbox.paypal.com";
    const tokens = new TokenProvider({
      clientId: "a",
      clientSecret: "b",
      baseUrl: base,
      fetch: f.fetch,
      log: silentLogger,
    });
    const api = createWebhooksApi(
      new HttpClient({ baseUrl: base, tokens, log: silentLogger, fetch: f.fetch, sleep: noSleep }),
    );
    const input = { headers, rawBody: '{"id":"WH-1"}', webhookId: "W" };
    expect(await api.verifySignature(input)).toBe(true);
    expect(await api.verifySignature(input)).toBe(false);
    expect(f.requests[0]!.url.pathname).toBe("/v1/notifications/verify-webhook-signature");
    expect(f.requests[0]!.headers["paypal-request-id"]).toBe(`verify:${headers["paypal-transmission-id"]}`);
  });
});
