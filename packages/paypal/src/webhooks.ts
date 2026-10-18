import type { HttpClient } from "./http.js";
import { VerifyWebhookResponseSchema, WEBHOOK_HEADERS } from "./schemas/webhook.js";

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export interface VerifyWebhookInput {
  headers: WebhookHeaders;
  /** The request body exactly as received. */
  rawBody: string;
  webhookId: string;
}

export interface WebhooksApi {
  /** True only when PayPal answers `verification_status: SUCCESS`. */
  verifySignature(input: VerifyWebhookInput): Promise<boolean>;
}

export class MissingWebhookHeadersError extends Error {
  override readonly name = "MissingWebhookHeadersError";
}

function header(headers: WebhookHeaders, name: string): string {
  const v = headers[name];
  const value = Array.isArray(v) ? v[0] : v;
  if (!value) throw new MissingWebhookHeadersError(`Missing webhook header ${name}`);
  return value;
}

/**
 * Builds the verify-webhook-signature body by splicing the raw event in, rather than
 * re-serialising a parsed copy, so PayPal checks the signature against the exact bytes it sent.
 */
export function buildVerifyBody(input: VerifyWebhookInput): string {
  const h = input.headers;
  const fields = {
    auth_algo: header(h, WEBHOOK_HEADERS.authAlgo),
    cert_url: header(h, WEBHOOK_HEADERS.certUrl),
    transmission_id: header(h, WEBHOOK_HEADERS.transmissionId),
    transmission_sig: header(h, WEBHOOK_HEADERS.transmissionSig),
    transmission_time: header(h, WEBHOOK_HEADERS.transmissionTime),
    webhook_id: input.webhookId,
  };
  JSON.parse(input.rawBody); // must be valid JSON before we splice it in
  return `${JSON.stringify(fields).slice(0, -1)},"webhook_event":${input.rawBody}}`;
}

export function createWebhooksApi(http: HttpClient): WebhooksApi {
  return {
    async verifySignature(input) {
      const rawJson = buildVerifyBody(input);
      const res = await http.request({
        method: "POST",
        path: "/v1/notifications/verify-webhook-signature",
        idempotencyKey: `verify:${header(input.headers, WEBHOOK_HEADERS.transmissionId)}`,
        rawJson,
        schema: VerifyWebhookResponseSchema,
      });
      return res.verification_status === "SUCCESS";
    },
  };
}
