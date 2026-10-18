import { describe, expect, it } from "vitest";
import { TokenProvider } from "./auth.js";
import { createDisputesApi, disputePath, nextPageToken } from "./disputes.js";
import { EvidenceTooLargeError } from "./errors.js";
import { HttpClient } from "./http.js";
import { silentLogger } from "./logger.js";
import { pdf } from "./testing/files.js";
import { fakeFetch, json, noSleep } from "./testing/fake-fetch.js";
import type { DisputesReader } from "./toolkit.js";
import dispute from "../../../fixtures/paypal/dispute-not-received.json" with { type: "json" };

const BASE = "https://api-m.sandbox.paypal.com";

function setup(responders: Parameters<typeof fakeFetch>[0], reader?: DisputesReader) {
  const f = fakeFetch(responders);
  const tokens = new TokenProvider({
    clientId: "id",
    clientSecret: "s",
    baseUrl: BASE,
    fetch: f.fetch,
    log: silentLogger,
  });
  const http = new HttpClient({ baseUrl: BASE, tokens, log: silentLogger, fetch: f.fetch, sleep: noSleep });
  return { api: createDisputesApi(http, silentLogger, reader), f };
}

const page = (ids: string[], next?: string) => ({
  items: ids.map((id) => ({ dispute_id: id, status: "OPEN" })),
  links: next
    ? [
        {
          href: `${BASE}/v1/customer/disputes?page_size=2&next_page_token=${next}`,
          rel: "next",
          method: "GET",
        },
      ]
    : [],
});

function fakeReader(impl: Partial<DisputesReader> = {}): DisputesReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    name: "fake-toolkit",
    calls,
    list: impl.list ?? (async () => (calls.push("list"), page(["PP-D-T1"]))),
    show: impl.show ?? (async () => (calls.push("show"), dispute)),
  };
}

describe("disputes.list / show", () => {
  it("serves simple list and show calls through the agent toolkit", async () => {
    const reader = fakeReader();
    const { api, f } = setup([], reader);
    expect((await api.list({ page_size: 5 })).items.map((d) => d.dispute_id)).toEqual(["PP-D-T1"]);
    expect((await api.show(dispute.dispute_id)).reason).toBe("MERCHANDISE_OR_SERVICE_NOT_RECEIVED");
    expect(reader.calls).toEqual(["list", "show"]);
    expect(f.requests).toHaveLength(0);
  });

  it("uses REST for filters the toolkit doesn't support (time windows, page tokens)", async () => {
    const reader = fakeReader();
    const { api, f } = setup([() => json(200, page(["PP-D-R1"]))], reader);
    const res = await api.list({ update_time_after: "2026-10-19T00:00:00Z", page_size: 50 });
    expect(res.items[0]!.dispute_id).toBe("PP-D-R1");
    expect(reader.calls).toEqual([]);
    expect(f.requests[0]!.url.searchParams.get("update_time_after")).toBe("2026-10-19T00:00:00Z");
  });

  it("falls back to REST when the toolkit call fails", async () => {
    const reader = fakeReader({
      show: async () => {
        throw new Error("toolkit exploded");
      },
    });
    const { api, f } = setup([() => json(200, dispute)], reader);
    expect((await api.show(dispute.dispute_id)).dispute_id).toBe(dispute.dispute_id);
    expect(f.requests[0]!.url.pathname).toBe(`/v1/customer/disputes/${dispute.dispute_id}`);
  });

  it("pages through next_page_token", async () => {
    const { api, f } = setup([() => json(200, page(["A", "B"], "tok2")), () => json(200, page(["C"]))]);
    const ids: string[] = [];
    for await (const d of api.listAll({ start_time: "2026-10-01T00:00:00Z" })) ids.push(d.dispute_id);
    expect(ids).toEqual(["A", "B", "C"]);
    expect(f.requests[1]!.url.searchParams.get("next_page_token")).toBe("tok2");
    expect(f.requests[1]!.url.searchParams.get("start_time")).toBe("2026-10-01T00:00:00Z");
  });

  it("extracts the next page token from HATEOAS links", () => {
    expect(nextPageToken([{ rel: "next", href: "/v1/customer/disputes?next_page_token=abc%3D" }])).toBe(
      "abc=",
    );
    expect(nextPageToken([{ rel: "self", href: "/x" }])).toBeUndefined();
  });

  it("rejects dispute ids that could escape the path", () => {
    expect(() => disputePath("../../v1/oauth2")).toThrow(/Invalid PayPal dispute id/);
    expect(disputePath("PP-D-123", "make-offer")).toBe("/v1/customer/disputes/PP-D-123/make-offer");
  });
});

describe("disputes write calls", () => {
  it("provide-evidence sends multipart with the idempotency key", async () => {
    const { api, f } = setup([() => json(200, { links: [] })]);
    await api.provideEvidence(
      "PP-D-1",
      {
        evidences: [
          { evidence_type: "PROOF_OF_FULFILLMENT", notes: "Delivered", documents: [{ name: "pack.pdf" }] },
        ],
      },
      [pdf("pack.pdf")],
      "c1:d1:PROVIDE_EVIDENCE",
    );
    const req = f.requests[0]!;
    expect(req.url.pathname).toBe("/v1/customer/disputes/PP-D-1/provide-evidence");
    expect(req.headers["paypal-request-id"]).toBe("c1:d1:PROVIDE_EVIDENCE");
    const form = req.body as FormData;
    expect(JSON.parse(await (form.get("input") as Blob).text()).evidences[0].evidence_type).toBe(
      "PROOF_OF_FULFILLMENT",
    );
    expect((form.get("evidence-file") as File).name).toBe("pack.pdf");
  });

  it("rejects oversize evidence without calling PayPal", async () => {
    const { api, f } = setup([]);
    expect(() =>
      api.provideEvidence(
        "PP-D-1",
        { evidences: [{ evidence_type: "OTHER", documents: [{ name: "big.pdf" }] }] },
        [pdf("big.pdf", 12 * 1024 * 1024)],
        "k",
      ),
    ).toThrow(EvidenceTooLargeError);
    expect(f.requests).toHaveLength(0);
  });

  it("rejects documents that have no uploaded file", async () => {
    const { api } = setup([]);
    expect(() =>
      api.provideEvidence(
        "PP-D-1",
        { evidences: [{ evidence_type: "OTHER", documents: [{ name: "missing.pdf" }] }] },
        [],
        "k",
      ),
    ).toThrow(/missing\.pdf/);
  });

  it("make-offer, accept-claim, send-message and sandbox helpers post JSON", async () => {
    const ok = () => json(200, { links: [] });
    const { api, f } = setup([ok, ok, ok, ok, ok]);
    await api.makeOffer(
      "PP-D-1",
      {
        offer_type: "REFUND",
        offer_amount: { currency_code: "USD", value: "10.00" },
        note: "Partial refund",
      },
      "k1",
    );
    await api.acceptClaim("PP-D-1", { note: "Sorry" }, "k2");
    await api.sendMessage("PP-D-1", { message: "Hi" }, "k3");
    await api.requireEvidence("PP-D-1", "SELLER_EVIDENCE", "k4");
    await api.adjudicate("PP-D-1", "SELLER_FAVOR", "k5");
    expect(f.requests.map((r) => [r.url.pathname.split("/").pop(), r.body])).toEqual([
      [
        "make-offer",
        '{"offer_type":"REFUND","offer_amount":{"currency_code":"USD","value":"10.00"},"note":"Partial refund"}',
      ],
      ["accept-claim", '{"note":"Sorry"}'],
      ["send-message", '{"message":"Hi"}'],
      ["require-evidence", '{"action":"SELLER_EVIDENCE"}'],
      ["adjudicate", '{"adjudication_outcome":"SELLER_FAVOR"}'],
    ]);
  });

  it("refuses a refund offer without an amount", () => {
    const { api } = setup([]);
    expect(() => api.makeOffer("PP-D-1", { offer_type: "REFUND", note: "x" }, "k")).toThrow(/offer_amount/);
  });
});
