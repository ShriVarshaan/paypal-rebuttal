import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { AppDeps } from "../app.js";
import { tokenMatches } from "./cases.js";

export interface StreamOptions {
  /** How often the stream checks for new rows. */
  pollMs?: number;
  heartbeatMs?: number;
}

/**
 * GET /events/stream (C, Day 13): Server-Sent Events for the web app. It tails CaseEvent and
 * Notification rows written by the worker, so the queue, the case page and the bell update
 * in place without the browser polling every view. Postgres is the source of truth; a lost
 * connection only means the client reconnects and refetches.
 */
export function streamRoutes(deps: AppDeps, opts: StreamOptions = {}): FastifyPluginAsync {
  const pollMs = opts.pollMs ?? 1_500;
  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  return async (app) => {
    // Open streams end when the server closes, so shutdown never waits on a browser tab.
    const open = new Set<() => void>();
    app.addHook("onClose", async () => {
      for (const close of open) close();
    });

    app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
      if (deps.config.apiToken && !tokenMatches(req.headers.authorization, deps.config.apiToken)) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    });

    app.get("/events/stream", { config: { rateLimit: false } }, async (req, reply) => {
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      const send = (event: string, data: unknown, id?: string) =>
        res.write(`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      send("ready", { at: new Date().toISOString() });

      // Start from "now" (or the client's Last-Event-ID after a reconnect) so old rows never replay.
      const lastEventId = req.headers["last-event-id"];
      const resumeAt = typeof lastEventId === "string" ? Date.parse(lastEventId.split("|")[0] ?? "") : NaN;
      let cursor = Number.isNaN(resumeAt) ? new Date() : new Date(resumeAt);
      let busy = false;
      let closed = false;

      const tick = async () => {
        if (busy || closed) return;
        busy = true;
        try {
          const [events, notifications] = await Promise.all([
            deps.db.caseEvent.findMany({
              where: { createdAt: { gt: cursor } },
              orderBy: { createdAt: "asc" },
              take: 200,
              include: {
                case: {
                  select: {
                    paypalDisputeId: true,
                    reason: true,
                    amountCents: true,
                    currency: true,
                    sellerResponseDueAt: true,
                    state: true,
                  },
                },
              },
            }),
            deps.db.notification.findMany({
              where: { createdAt: { gt: cursor } },
              orderBy: { createdAt: "asc" },
              take: 50,
            }),
          ]);
          let latest = cursor;
          for (const e of events) {
            const at = e.createdAt.toISOString();
            send(
              "case",
              {
                id: e.id,
                caseId: e.caseId,
                type: e.type,
                createdAt: at,
                case: {
                  paypalDisputeId: e.case.paypalDisputeId,
                  reason: e.case.reason,
                  amountCents: e.case.amountCents,
                  currency: e.case.currency,
                  sellerResponseDueAt: e.case.sellerResponseDueAt?.toISOString() ?? null,
                  state: e.case.state,
                },
              },
              `${at}|${e.id}`,
            );
            if (e.createdAt > latest) latest = e.createdAt;
          }
          for (const n of notifications) {
            send("notification", {
              id: n.id,
              caseId: n.caseId,
              kind: n.kind,
              level: n.level,
              message: n.message,
              createdAt: n.createdAt.toISOString(),
            });
            if (n.createdAt > latest) latest = n.createdAt;
          }
          cursor = latest;
        } catch (err) {
          req.log.warn({ err: (err as Error).message }, "event stream poll failed");
        } finally {
          busy = false;
        }
      };

      const poll = setInterval(() => void tick(), pollMs);
      const heartbeat = setInterval(() => res.write(`: keep-alive\n\n`), heartbeatMs);
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(poll);
        clearInterval(heartbeat);
        open.delete(close);
        res.end();
      };
      open.add(close);
      req.raw.on("close", close);
    });
  };
}
