import cors from "@fastify/cors";
import type { LlmClient } from "@rebuttal/agent";
import rateLimit from "@fastify/rate-limit";
import type { Db } from "@rebuttal/db";
import type { PayPalClient } from "@rebuttal/paypal";
import type { JobQueue } from "@rebuttal/worker";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { ApiConfig } from "./config.js";
import { caseRoutes } from "./routes/cases.js";
import { healthRoutes } from "./routes/health.js";
import { intelligenceRoutes } from "./routes/intelligence.js";
import { webhookRoutes } from "./routes/webhooks.js";

export interface AppDeps {
  db: Db;
  paypal: PayPalClient;
  queue: JobQueue;
  config: ApiConfig;
  /** Health check for the job queue. */
  checkQueue: () => Promise<void>;
  /** Claude for buyer-message drafts; null/absent = templates. */
  llm?: LlmClient | null;
}

export async function buildApp(deps: AppDeps, opts: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env["LOG_LEVEL"] ?? "info",
      // Request logs must never carry tokens or PayPal signatures.
      redact: ["req.headers.authorization", 'req.headers["paypal-transmission-sig"]'],
    },
    trustProxy: deps.config.production,
    bodyLimit: 1_000_000,
    ...opts,
  });

  await app.register(cors, { origin: deps.config.webOrigin, credentials: true });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  await app.register(healthRoutes(deps));
  await app.register(webhookRoutes(deps));
  await app.register(caseRoutes(deps));
  await app.register(intelligenceRoutes(deps));
  return app;
}
