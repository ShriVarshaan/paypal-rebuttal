import { z } from "zod";

export const WebhookEventSchema = z.looseObject({
  id: z.string(),
  event_type: z.string(),
  resource_type: z.string().optional(),
  create_time: z.string().optional(),
  summary: z.string().optional(),
  resource: z.looseObject({}),
});
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

/** The resource of `CUSTOMER.DISPUTE.*` events is the dispute (at least its id). */
export const DisputeWebhookResourceSchema = z.looseObject({ dispute_id: z.string() });

export const VerifyWebhookResponseSchema = z.object({
  verification_status: z.enum(["SUCCESS", "FAILURE"]),
});

/** Header names PayPal sends on every webhook delivery (lower-cased, as Node exposes them). */
export const WEBHOOK_HEADERS = {
  transmissionId: "paypal-transmission-id",
  transmissionTime: "paypal-transmission-time",
  certUrl: "paypal-cert-url",
  authAlgo: "paypal-auth-algo",
  transmissionSig: "paypal-transmission-sig",
} as const;
