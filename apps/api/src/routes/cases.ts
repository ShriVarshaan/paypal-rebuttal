import { timingSafeEqual } from "node:crypto";
import { TERMINAL_STATES, CaseState, MerchantSummary } from "@rebuttal/core";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { sendStoredFile } from "../files.js";
import type { Prisma } from "@rebuttal/db";
import { caseRelations, detail, queueItem, queueRelations } from "../serializers.js";

export function tokenMatches(header: string | undefined, token: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

const Query = z.object({
  /** One CaseState, or several separated by commas (e.g. LOST,APPEAL_DRAFTED). */
  state: z
    .string()
    .transform((v) => v.split(",").map((s) => s.trim()))
    .pipe(z.array(CaseState).min(1).max(12))
    .optional(),
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

/** The columns the list filters and sorts on; relations load only for the page returned. */
const listSelect = {
  id: true,
  paypalDisputeId: true,
  sellerTransactionId: true,
  disputedTransactions: true,
  state: true,
  sellerResponseDueAt: true,
  amountCents: true,
  currency: true,
  createdAt: true,
  decisions: { select: { status: true }, orderBy: { createdAt: "desc" as const } },
} satisfies Prisma.CaseSelect;
type ListRow = Prisma.CaseGetPayload<{ select: typeof listSelect }>;

function transactionText(value: unknown): string {
  return JSON.stringify(value ?? "").toLowerCase();
}

function matchesSearch(row: ListRow, query: string): boolean {
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

function awaitingApproval(row: ListRow): boolean {
  return (
    row.state === "AWAITING_APPROVAL" &&
    row.decisions.find((decision) => decision.status !== "REJECTED")?.status === "PROPOSED"
  );
}

function deadline(row: ListRow): number | null {
  return row.sellerResponseDueAt?.getTime() ?? null;
}

function compareRows(left: ListRow, right: ListRow, sort: z.infer<typeof Query>["sort"]): number {
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

/** REST for the web app and MCP: merchant, case list/detail, evidence files, notifications. */
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
      const now = Date.now();
      const rows = await deps.db.case.findMany({
        // The cheap column filters run in Postgres; the in-memory ones below stay authoritative.
        where: {
          AND: [
            q.state ? { state: { in: q.state } } : {},
            q.reason ? { reason: q.reason } : {},
            q.needsApproval ? { state: "AWAITING_APPROVAL" as const } : {},
            q.dueWithinHours
              ? { sellerResponseDueAt: { lte: new Date(now + q.dueWithinHours * 60 * 60 * 1000) } }
              : {},
          ],
        },
        select: listSelect,
      });
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
      const ids = filtered.slice(q.skip, q.skip + q.take).map((row) => row.id);
      const page = await deps.db.case.findMany({ where: { id: { in: ids } }, include: queueRelations });
      const byId = new Map(page.map((row) => [row.id, row]));
      return ids.flatMap((id) => {
        const row = byId.get(id);
        return row ? [queueItem(row)] : [];
      });
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
      return sendStoredFile(reply, deps.config.evidenceStorageDir, evidence.filePath);
    });

    app.get("/notifications", async () =>
      deps.db.notification.findMany({ where: { readAt: null }, orderBy: { createdAt: "desc" }, take: 50 }),
    );
  };
}
