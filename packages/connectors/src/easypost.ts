import type { EvidenceItem } from "@rebuttal/core";
import { z } from "zod";
import type { ConnectorCase, EvidenceSource } from "./types.js";

const TrackerSchema = z.looseObject({
  id: z.string(),
  tracking_code: z.string(),
  status: z.string(),
  carrier: z.string().nullish(),
  signed_by: z.string().nullish(),
  est_delivery_date: z.string().nullish(),
  public_url: z.string().nullish(),
  tracking_details: z
    .array(
      z.looseObject({
        status: z.string().nullish(),
        message: z.string().nullish(),
        datetime: z.string().nullish(),
        tracking_location: z
          .looseObject({
            city: z.string().nullish(),
            state: z.string().nullish(),
            country: z.string().nullish(),
            zip: z.string().nullish(),
          })
          .nullish(),
      }),
    )
    .default([]),
});
export type EasyPostTracker = z.infer<typeof TrackerSchema>;

/**
 * EasyPost test-mode tracking codes and the status each one always returns
 * (https://docs.easypost.com/docs/trackers#test-tracking-codes).
 */
export const EASYPOST_TEST_CODES: Record<string, string> = {
  EZ1000000001: "pre_transit",
  EZ2000000002: "in_transit",
  EZ3000000003: "out_for_delivery",
  EZ4000000004: "delivered",
  EZ5000000005: "return_to_sender",
  EZ6000000006: "failure",
  EZ7000000007: "unknown",
};

export function trackingNumbers(c: ConnectorCase): string[] {
  return [...new Set(c.transactionContext?.order?.trackingNumbers.map((t) => t.trackingNumber) ?? [])];
}

export function trackerToEvidence(t: EasyPostTracker, c: ConnectorCase, capturedAt: Date): EvidenceItem {
  const delivered = [...t.tracking_details].reverse().find((d) => d.status === "delivered");
  const shippedTo = c.transactionContext?.order?.shipping?.address ?? null;
  return {
    source: "easypost",
    type: "PROOF_OF_FULFILLMENT",
    title: `Carrier tracking ${t.tracking_code}${t.carrier ? ` (${t.carrier})` : ""}: ${t.status}`,
    dedupeKey: `tracker:${t.tracking_code}`,
    capturedAt: capturedAt.toISOString(),
    data: {
      trackingCode: t.tracking_code,
      carrier: t.carrier ?? null,
      status: t.status,
      deliveredAt: delivered?.datetime ?? null,
      deliveredTo: delivered?.tracking_location ?? null,
      signedBy: t.signed_by ?? null,
      estDeliveryDate: t.est_delivery_date ?? null,
      publicUrl: t.public_url ?? null,
      shippingPostalCode: shippedTo?.["postal_code"] ?? null,
      events: t.tracking_details.map((d) => ({
        status: d.status ?? null,
        message: d.message ?? null,
        at: d.datetime ?? null,
        location: d.tracking_location ?? null,
      })),
    },
  };
}

export interface EasyPostOptions {
  apiKey: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  now?: () => Date;
}

export function createEasyPostSource(opts: EasyPostOptions): EvidenceSource {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const baseUrl = opts.baseUrl ?? "https://api.easypost.com/v2";
  const auth = `Basic ${Buffer.from(`${opts.apiKey}:`).toString("base64")}`;
  const now = opts.now ?? (() => new Date());

  async function track(code: string): Promise<EasyPostTracker> {
    // Creating a tracker for a known code returns the existing one, so this is safe to repeat.
    const res = await fetchImpl(`${baseUrl}/trackers`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        tracker: { tracking_code: code, ...(code in EASYPOST_TEST_CODES ? { carrier: "USPS" } : {}) },
      }),
    });
    if (!res.ok) throw new Error(`EasyPost tracker ${code} failed with ${res.status}`);
    return TrackerSchema.parse(await res.json());
  }

  return {
    id: "easypost",
    supports: (c) => trackingNumbers(c).length > 0,
    async gather(c) {
      const trackers = await Promise.all(trackingNumbers(c).map(track));
      return trackers.map((t) => trackerToEvidence(t, c, now()));
    },
  };
}

/** Offline stand-in for simulator mode and tests: test codes resolve to their fixed status. */
export function createOfflineEasyPostSource(now: () => Date = () => new Date()): EvidenceSource {
  return {
    id: "easypost",
    supports: (c) => trackingNumbers(c).length > 0,
    async gather(c) {
      const shippedAt = c.disputedTransactions[0]?.createdAt ?? now().toISOString();
      return trackingNumbers(c).map((code) => {
        const status = EASYPOST_TEST_CODES[code] ?? "unknown";
        const deliveredAt = new Date(new Date(shippedAt).getTime() + 3 * 24 * 3600 * 1000).toISOString();
        const tracker: EasyPostTracker = {
          id: `trk_sim_${code}`,
          tracking_code: code,
          status,
          carrier: "USPS",
          signed_by: status === "delivered" ? "J. DOE" : null,
          tracking_details: [
            { status: "pre_transit", message: "Shipping label created", datetime: shippedAt },
            ...(status === "pre_transit"
              ? []
              : [{ status, message: `Package ${status.replaceAll("_", " ")}`, datetime: deliveredAt }]),
          ],
        };
        return trackerToEvidence(tracker, c, now());
      });
    },
  };
}
