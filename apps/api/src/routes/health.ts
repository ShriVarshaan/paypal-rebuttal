import type { FastifyPluginAsync } from "fastify";
import type { AppDeps } from "../app.js";

const TIMEOUT_MS = 3000;

async function check(fn: () => Promise<unknown>): Promise<{ ok: boolean; error?: string; ms: number }> {
  const started = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
    ]);
    return { ok: true, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), ms: Date.now() - started };
  }
}

/** GET /healthz: database, queue and PayPal token. 503 if any fails. */
export function healthRoutes(deps: AppDeps): FastifyPluginAsync {
  return async (app) => {
    app.get("/healthz", { config: { rateLimit: false } }, async (_req, reply) => {
      const [db, queue, paypal] = await Promise.all([
        check(() => deps.db.$queryRaw`SELECT 1`),
        check(deps.checkQueue),
        check(() => deps.paypal.ping()),
      ]);
      const ok = db.ok && queue.ok && paypal.ok;
      return reply.code(ok ? 200 : 503).send({ ok, mode: deps.paypal.mode, checks: { db, queue, paypal } });
    });
  };
}
