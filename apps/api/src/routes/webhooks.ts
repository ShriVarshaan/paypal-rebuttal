import { WebhookEventType } from "@rebuttal/core";
import { isUniqueViolation } from "@rebuttal/db";
import {
  DisputeWebhookResourceSchema,
  MissingWebhookHeadersError,
  WebhookEventSchema,
} from "@rebuttal/paypal";
import { QUEUES } from "@rebuttal/worker";
import type { FastifyPluginAsync } from "fastify";
import type { AppDeps } from "../app.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

/**
 * POST /webhooks/paypal: verify with PayPal, store once per event id, enqueue a sync,
 * and answer fast. All real work happens in the worker.
 */
export function webhookRoutes(deps: AppDeps): FastifyPluginAsync {
  const skipVerify = deps.config.skipWebhookVerify || deps.paypal.mode === "simulator";

  return async (app) => {
    // Keep the raw body: verification must use the exact bytes PayPal signed.
    app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
      req.rawBody = body as string;
      try {
        done(null, JSON.parse(body as string));
      } catch {
        done(Object.assign(new Error("Invalid JSON"), { statusCode: 400 }), undefined);
      }
    });

    app.post(
      "/webhooks/paypal",
      { config: { rateLimit: { max: 1200, timeWindow: "1 minute" } } },
      async (req, reply) => {
        const parsed = WebhookEventSchema.safeParse(req.body);
        if (!parsed.success) return reply.code(400).send({ error: "not a PayPal webhook event" });
        const event = parsed.data;

        let verified = false;
        if (!skipVerify) {
          if (!deps.config.webhookId) {
            req.log.error("PAYPAL_WEBHOOK_ID is not set; refusing webhook");
            return reply.code(500).send({ error: "webhook not configured" });
          }
          try {
            verified = await deps.paypal.webhooks.verifySignature({
              headers: req.headers,
              rawBody: req.rawBody ?? "",
              webhookId: deps.config.webhookId,
            });
          } catch (err) {
            if (err instanceof MissingWebhookHeadersError)
              return reply.code(400).send({ error: err.message });
            req.log.warn({ err: (err as Error).message }, "webhook verification call failed");
            return reply.code(502).send({ error: "verification unavailable" }); // PayPal will redeliver
          }
          if (!verified) {
            req.log.warn({ eventId: event.id, eventType: event.event_type }, "webhook signature rejected");
            return reply.code(400).send({ error: "invalid signature" });
          }
        }

        const resource = DisputeWebhookResourceSchema.safeParse(event.resource);
        const disputeId = resource.success ? resource.data.dispute_id : null;
        const enqueue = disputeId && WebhookEventType.safeParse(event.event_type).success;
        try {
          await deps.db.webhookEvent.create({
            data: {
              paypalEventId: event.id,
              eventType: event.event_type,
              resourceId: disputeId,
              verified,
              payload: event as object,
            },
          });
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
          // A redelivery. If the first attempt died before enqueueing, finish the job now.
          const prior = await deps.db.webhookEvent.findUnique({ where: { paypalEventId: event.id } });
          if (!enqueue || prior?.processedAt)
            return reply.code(200).send({ received: true, duplicate: true });
        }

        if (enqueue) {
          await deps.queue.send(QUEUES.disputeSync, { disputeId }, { singletonKey: disputeId });
          await deps.db.webhookEvent.update({
            where: { paypalEventId: event.id },
            data: { processedAt: new Date() },
          });
        }
        req.log.info(
          { eventId: event.id, eventType: event.event_type, disputeId, verified },
          "webhook accepted",
        );
        return reply.code(200).send({ received: true });
      },
    );
  };
}
