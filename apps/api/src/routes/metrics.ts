import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { findRepoRoot } from "@rebuttal/paypal";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { computeMetrics, type MetricCase } from "../metrics.js";
import { tokenMatches } from "./cases.js";

const RESPONSES = new Set(["PROVIDE_EVIDENCE", "MAKE_OFFER", "ACCEPT_CLAIM"]);

export interface MetricsOptions {
  /** B's eval report; default packages/eval/reports/latest.json. */
  evalReportPath?: string;
}

/** C's dashboard and eval page data (Day 15). Same bearer token as the other routes. */
export function metricsRoutes(deps: AppDeps, opts: MetricsOptions = {}): FastifyPluginAsync {
  const reportPath = opts.evalReportPath ?? join(findRepoRoot(), "packages/eval/reports/latest.json");
  return async (app) => {
    app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
      if (deps.config.apiToken && !tokenMatches(req.headers.authorization, deps.config.apiToken)) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    });

    app.get("/metrics/summary", async (req) => {
      const { weeks } = z
        .object({ weeks: z.coerce.number().int().min(4).max(52).default(12) })
        .parse(req.query);
      const [rows, orders, runs] = await Promise.all([
        deps.db.case.findMany({
          include: {
            actions: { where: { status: "SUCCEEDED" }, orderBy: { completedAt: "asc" } },
            events: { where: { type: "OUTCOME" }, orderBy: { createdAt: "asc" }, take: 1 },
          },
        }),
        deps.db.storeOrder.findMany({
          where: { placedAt: { gte: new Date(Date.now() - (weeks + 1) * 7 * 86_400_000) } },
          select: { placedAt: true },
        }),
        deps.db.agentRun.findMany({ select: { caseId: true, costUsd: true } }),
      ]);
      const cases: MetricCase[] = rows.map((r) => {
        const responses = r.actions.filter((a) => RESPONSES.has(a.kind));
        const offer = responses.find((a) => a.kind === "MAKE_OFFER");
        const offerCents = (offer?.request as { offerAmountCents?: unknown } | null)?.offerAmountCents;
        const resolved = r.state === "WON" || r.state === "LOST" || r.state === "REFUNDED";
        return {
          id: r.id,
          reason: r.reason,
          amountCents: r.amountCents,
          currency: r.currency,
          state: r.state,
          createdAt: r.createdAt,
          paypalCreatedAt: r.paypalCreatedAt,
          sellerResponseDueAt: r.sellerResponseDueAt,
          resolvedAt: r.events[0]?.createdAt ?? (resolved ? r.updatedAt : null),
          firstResponseAt: responses[0]?.completedAt ?? null,
          filedEvidence: responses.some((a) => a.kind === "PROVIDE_EVIDENCE"),
          offerPaidCents: typeof offerCents === "number" ? offerCents : null,
        };
      });
      return computeMetrics({ cases, orders, runs, now: new Date(), weeks });
    });

    /** B's latest eval report, as written by `pnpm eval`. */
    app.get("/eval/report", async (_req, reply) => {
      const text = await readFile(reportPath, "utf8").catch(() => null);
      if (!text) return reply.code(404).send({ error: "no eval report yet; run pnpm eval" });
      try {
        return reply.type("application/json").send(JSON.parse(text));
      } catch {
        return reply.code(500).send({ error: "eval report is not valid JSON" });
      }
    });
  };
}
