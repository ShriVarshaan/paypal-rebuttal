import { timingSafeEqual } from "node:crypto";
import { QUEUES } from "@rebuttal/worker";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.js";

function tokenMatches(header: string | undefined, token: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * Minimal REST for the web app and demo: case list/detail, notifications, and the
 * approve button that hands a Decision to the executor. C extends these.
 */
export function caseRoutes(deps: AppDeps): FastifyPluginAsync {
  return async (app) => {
    app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
      if (deps.config.apiToken && !tokenMatches(req.headers.authorization, deps.config.apiToken)) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    });

    app.get("/cases", async (req) => {
      const q = z
        .object({ state: z.string().optional(), take: z.coerce.number().int().min(1).max(200).default(100) })
        .parse(req.query);
      return deps.db.case.findMany({
        where: q.state ? { state: q.state as never } : {},
        orderBy: [{ sellerResponseDueAt: "asc" }, { createdAt: "desc" }],
        take: q.take,
        omit: { raw: true },
      });
    });

    app.get("/cases/:id", async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const c = await deps.db.case.findUnique({
        where: { id },
        include: {
          events: { orderBy: { createdAt: "asc" } },
          evidence: true,
          decisions: { orderBy: { createdAt: "desc" } },
          actions: { orderBy: { createdAt: "asc" } },
          packs: true,
        },
      });
      return c ?? reply.code(404).send({ error: "not found" });
    });

    app.get("/notifications", async () =>
      deps.db.notification.findMany({ where: { readAt: null }, orderBy: { createdAt: "desc" }, take: 50 }),
    );

    app.post("/decisions/:id/approve", async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const body = z
        .object({ approvedBy: z.string().min(1).max(100).default("seller") })
        .parse(req.body ?? {});
      const updated = await deps.db.decision.updateMany({
        where: { id, status: "PROPOSED" },
        data: { status: "APPROVED", approvedBy: body.approvedBy, approvedAt: new Date() },
      });
      if (updated.count === 0) {
        const exists = await deps.db.decision.findUnique({ where: { id }, select: { status: true } });
        return reply
          .code(exists ? 409 : 404)
          .send({ error: exists ? `decision is ${exists.status}` : "not found" });
      }
      await deps.queue.send(QUEUES.actionExecute, { decisionId: id }, { singletonKey: id });
      return deps.db.decision.findUnique({ where: { id } });
    });
  };
}
