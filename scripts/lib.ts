import { randomUUID } from "node:crypto";
import { createPayPalClient, type Dispute, type PayPalClient } from "@rebuttal/paypal";

export function paypal(): PayPalClient {
  return createPayPalClient();
}

export function arg(i: number, usage: string): string {
  const v = process.argv[2 + i];
  if (!v) {
    console.error(`usage: ${usage}`);
    process.exit(1);
  }
  return v;
}

export const apiUrl = () => (process.env.API_URL ?? "http://localhost:3001").replace(/\/+$/, "");

/** A fresh key per script run: each run is a new, intentional action. */
export const scriptKey = (what: string, id: string) => `script:${what}:${id}:${randomUUID()}`;

/**
 * Simulator mode has no PayPal to send webhooks, so the scripts post an unsigned one to our
 * own endpoint. The api accepts unsigned webhooks only in simulator mode.
 */
export async function postSimWebhook(
  client: PayPalClient,
  eventType: string,
  dispute: Dispute,
): Promise<void> {
  if (client.mode !== "simulator") return;
  const event = {
    id: `WH-SIM-${randomUUID()}`,
    event_version: "1.0",
    create_time: new Date().toISOString(),
    resource_type: "dispute",
    event_type: eventType,
    summary: `Simulated ${eventType} for ${dispute.dispute_id}`,
    resource: dispute,
  };
  const res = await fetch(`${apiUrl()}/webhooks/paypal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  console.log(`webhook ${eventType} → ${res.status}`);
}
