import { timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { TERMINAL_STATES, CaseState, MerchantSummary } from "@rebuttal/core";
import { QUEUES } from "@rebuttal/worker";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { caseRelations, detail, queueItem, type CaseWithRelations } from "../serializers.js";

export function tokenMatches(header: string | undefined, token: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

const Query = z.object({
  state: CaseState.optional(),
  reason: z.string().trim().min(1).optional(),
  q: z.string().trim().max(200).optional(),
  sort: z
    .enum(["dueAt:asc", "dueAt:desc", "amount:asc", "amount:desc", "createdAt:asc", "createdAt:desc"])
    .default("dueAt:asc"),
  take: z.coerce.number().int().min(1).max(200).default(100),
  skip: z.coerce.number().int().min(0).default(0),
  needsApproval: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  dueWithinHours: z.coerce.number().int().min(1).max(8_760).optional(),
});

function transactionText(value: unknown): string {
  return JSON.stringify(value ?? "").toLowerCase();
}

function matchesSearch(row: CaseWithRelations, query: string): boolean {
  const haystack = [
    row.id,
    row.paypalDisputeId,
    row.sellerTransactionId ?? "",
    transactionText(row.disputedTransactions),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function awaitingApproval(row: CaseWithRelations): boolean {
  return (
    row.state === "AWAITING_APPROVAL" &&
    row.decisions.find((decision) => decision.status !== "REJECTED")?.status === "PROPOSED"
  );
}

function deadline(row: CaseWithRelations): number | null {
  return row.sellerResponseDueAt?.getTime() ?? null;
}

function compareRows(
  left: CaseWithRelations,
  right: CaseWithRelations,
  sort: z.infer<typeof Query>["sort"],
): number {
  if (sort.startsWith("dueAt")) {
    const a = deadline(left);
    const b = deadline(right);
    if (a === null && b !== null) return 1;
    if (a !== null && b === null) return -1;
    if (a !== null && b !== null && a !== b) return sort.endsWith("desc") ? b - a : a - b;
  } else if (sort.startsWith("amount")) {
    if (left.currency !== right.currency) return left.currency.localeCompare(right.currency);
    if (left.amountCents !== right.amountCents)
      return sort.endsWith("desc")
        ? right.amountCents - left.amountCents
        : left.amountCents - right.amountCents;
  } else if (left.createdAt.getTime() !== right.createdAt.getTime()) {
    return sort.endsWith("desc")
      ? right.createdAt.getTime() - left.createdAt.getTime()
      : left.createdAt.getTime() - right.createdAt.getTime();
  }
  if (sort === "dueAt:asc" || sort === "dueAt:desc") {
    const created = right.createdAt.getTime() - left.createdAt.getTime();
    if (created) return created;
  }
  return left.id.localeCompare(right.id);
}

/** REST for the web app and MCP: list/detail, notifications, and decision approval. */
export function caseRoutes(deps: AppDeps): FastifyPluginAsync {
  return async (app) => {
    app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
      if (deps.config.apiToken && !tokenMatches(req.headers.authorization, deps.config.apiToken)) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    });

    app.get("/merchant", async (_req, reply) => {
      const merchant = await deps.db.merchant.findUnique({ where: { id: "default" } });
      return merchant
        ? reply.send(
            MerchantSummary.parse({
              id: merchant.id,
              name: merchant.name,
              defaultCurrency: merchant.defaultCurrency,
            }),
          )
        : reply.code(404).send({ error: "merchant not found" });
    });

    app.get("/cases", async (req, reply) => {
      const parsed = Query.safeParse(req.query);
      if (!parsed.success)
        return reply.code(400).send({ error: "invalid query", issues: parsed.error.issues });
      const q = parsed.data;
      const rows = await deps.db.case.findMany({
        where: {
          ...(q.state ? { state: q.state } : {}),
          ...(q.reason ? { reason: q.reason } : {}),
        },
        include: caseRelations,
      });
      const now = Date.now();
      const filtered = rows
        .filter((row) => !q.q || matchesSearch(row, q.q))
        .filter((row) => q.needsApproval === undefined || awaitingApproval(row) === q.needsApproval)
        .filter((row) => {
          if (!q.dueWithinHours) return true;
          if (TERMINAL_STATES.has(row.state)) return false;
          const due = deadline(row);
          return due !== null && due <= now + q.dueWithinHours * 60 * 60 * 1000;
        })
        .sort((left, right) => compareRows(left, right, q.sort));
      reply.header("X-Total-Count", String(filtered.length));
      return filtered.slice(q.skip, q.skip + q.take).map(queueItem);
    });

    app.get("/cases/:id", async (req, reply) => {
      const parsed = z.object({ id: z.string().min(1) }).safeParse(req.params);
      if (!parsed.success) return reply.code(400).send({ error: "invalid case id" });
      const row = await deps.db.case.findUnique({ where: { id: parsed.data.id }, include: caseRelations });
      return row ? detail(row) : reply.code(404).send({ error: "not found" });
    });

    app.get("/cases/:caseId/evidence/:evidenceId/file", async (req, reply) => {
      const parsed = z
        .object({ caseId: z.string().min(1), evidenceId: z.string().min(1) })
        .safeParse(req.params);
      if (!parsed.success) return reply.code(400).send({ error: "invalid evidence path" });
      const evidence = await deps.db.evidenceItem.findFirst({
        where: { id: parsed.data.evidenceId, caseId: parsed.data.caseId },
      });
      if (!evidence?.filePath) return reply.code(404).send({ error: "evidence file unavailable" });
      const root = await realpath(resolve(deps.config.evidenceStorageDir)).catch(() => null);
      if (!root) return reply.code(404).send({ error: "evidence storage unavailable" });
      const candidate = resolve(
        isAbsolute(evidence.filePath) ? evidence.filePath : root + "/" + evidence.filePath,
      );
      const target = await realpath(candidate).catch(() => null);
      if (!target) return reply.code(404).send({ error: "evidence file unavailable" });
      const escaped = relative(root, target).startsWith("..") || isAbsolute(relative(root, target));
      if (escaped) return reply.code(403).send({ error: "evidence file outside storage" });
      const info = await stat(target);
      if (!info.isFile()) return reply.code(404).send({ error: "evidence file unavailable" });
      const contentTypes: Record<string, string> = {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
      };
      const extension = target.slice(target.lastIndexOf(".")).toLowerCase();
      const contentType = contentTypes[extension];
      if (!contentType) return reply.code(415).send({ error: "unsupported evidence media" });
      return reply.type(contentType).send(createReadStream(target));
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

    for (const action of ["reject", "override"] as const) {
      app.post(`/decisions/:id/${action}`, async (_req, reply) =>
        reply.code(501).send({ error: `${action} is not available in Week 1` }),
      );
    }
  };
}
