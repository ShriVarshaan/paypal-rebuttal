import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { AppDeps } from "../app.js";
import { tokenMatches } from "./cases.js";

export interface StreamOptions {
  /** How often the stream checks for new rows. */
  pollMs?: number;
  heartbeatMs?: number;
}

/**
 * How far back each poll re-reads. `createdAt` is stamped at insert, not at commit, so a row
 * from a slower transaction can become visible after a newer one was already sent; re-reading
 * this window (and skipping ids already sent) still delivers it once.
 */
const OVERLAP_MS = 5_000;
const PAGE = 200;

type Key = { at: Date; id: string };
type Row = { id: string; createdAt: Date };

/** Rows in (from, upTo], or after `after` in (createdAt, id) order when paging a burst. */
function range(from: Date, after: Key | null, upTo: Date) {
  return {
    AND: [
      { createdAt: { lte: upTo } },
      after
        ? { OR: [{ createdAt: { gt: after.at } }, { createdAt: after.at, id: { gt: after.id } }] }
        : { createdAt: { gte: from } },
    ],
  };
}
const ORDER = [{ createdAt: "asc" as const }, { id: "asc" as const }];

/**
 * One table's position in the stream. Each table keeps its own cursor (a shared one skips
 * rows when either table's page is cut short) and pages through bursts by (createdAt, id).
 */
class Tail<T extends Row> {
  private cursor: number;
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly floor: Date,
    private readonly read: (where: ReturnType<typeof range>) => Promise<T[]>,
  ) {
    this.cursor = floor.getTime();
  }

  get position(): Date {
    return new Date(this.cursor);
  }

  async poll(upTo: Date): Promise<T[]> {
    // Never before the floor: a new connection (or a resume) does not replay older rows.
    const from = new Date(Math.max(this.cursor - OVERLAP_MS, this.floor.getTime()));
    const out: T[] = [];
    let after: Key | null = null;
    for (;;) {
      const rows = await this.read(range(from, after, upTo));
      for (const r of rows) {
        if (this.seen.has(r.id)) continue;
        this.seen.set(r.id, r.createdAt.getTime());
        out.push(r);
        this.cursor = Math.max(this.cursor, r.createdAt.getTime());
      }
      if (rows.length < PAGE) break;
      const last = rows[rows.length - 1]!;
      after = { at: last.createdAt, id: last.id };
    }
    for (const [id, at] of this.seen) if (at < this.cursor - OVERLAP_MS) this.seen.delete(id);
    return out;
  }
}

/** Last-Event-ID is "<case events position>|<notifications position>"; anything else starts fresh. */
function resumePoint(header: string | string[] | undefined): [Date, Date] | null {
  if (typeof header !== "string") return null;
  const [a, b] = header.split("|").map((s) => Date.parse(s));
  if (a === undefined || b === undefined || Number.isNaN(a) || Number.isNaN(b)) return null;
  // The client saw everything up to these instants; start just after them.
  return [new Date(a + 1), new Date(b + 1)];
}

/**
 * GET /events/stream (C, Day 13): Server-Sent Events for the web app. It tails CaseEvent and
 * Notification rows written by the worker, so the queue, the case page and the bell update
 * in place without the browser polling every view. Postgres is the source of truth; a lost
 * connection only means the client reconnects (resuming from Last-Event-ID) and refetches.
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

      const now = new Date();
      const [eventsFrom, notesFrom] = resumePoint(req.headers["last-event-id"]) ?? [now, now];
      const events = new Tail(eventsFrom, (where) =>
        deps.db.caseEvent.findMany({
          where,
          orderBy: ORDER,
          take: PAGE,
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
      );
      const notes = new Tail(notesFrom, (where) =>
        deps.db.notification.findMany({ where, orderBy: ORDER, take: PAGE }),
      );
      let busy = false;
      let closed = false;

      const tick = async () => {
        if (busy || closed) return;
        busy = true;
        // Never read past "now": a row stamped in the future would otherwise move the cursor
        // ahead and silence every real event until that time.
        const upTo = new Date();
        try {
          const [newEvents, newNotes] = await Promise.all([events.poll(upTo), notes.poll(upTo)]);
          const id = `${events.position.toISOString()}|${notes.position.toISOString()}`;
          for (const e of newEvents)
            send(
              "case",
              {
                id: e.id,
                caseId: e.caseId,
                type: e.type,
                createdAt: e.createdAt.toISOString(),
                case: {
                  paypalDisputeId: e.case.paypalDisputeId,
                  reason: e.case.reason,
                  amountCents: e.case.amountCents,
                  currency: e.case.currency,
                  sellerResponseDueAt: e.case.sellerResponseDueAt?.toISOString() ?? null,
                  state: e.case.state,
                },
              },
              id,
            );
          for (const n of newNotes)
            send(
              "notification",
              {
                id: n.id,
                caseId: n.caseId,
                kind: n.kind,
                level: n.level,
                message: n.message,
                createdAt: n.createdAt.toISOString(),
              },
              id,
            );
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
