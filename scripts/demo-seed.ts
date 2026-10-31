// Curated demo data for the video (role doc Day 17). Needs `SIMULATOR=1 pnpm dev` running.
//   pnpm demo:seed              open the curated disputes through the real pipeline
//   pnpm demo:seed --history    also backfill 12 weeks of synthetic store orders and resolved
//                               DEMO-HIST-* cases so the dashboard has a history to show
//   pnpm demo:seed --reset      first delete every case and reset the simulator (local only)
// Every dispute goes webhook → sync → enrich → gather → triage (→ PDF) in the running worker;
// the "already won" and "lost" stories are approved through the api and adjudicated in the
// simulator, exactly as the sandbox scripts do. Nothing here talks to PayPal.
import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDb, type Db } from "@rebuttal/db";
import { DisputeSchema, createSimulatorClient, findRepoRoot, type Dispute } from "@rebuttal/paypal";
import { apiUrl, postSimWebhook } from "./lib.js";

const print = (line: string) => process.stdout.write(`${line}\n`);
const root = findRepoRoot();
const client = createSimulatorClient();
if (client.mode !== "simulator" || process.env["SIMULATOR"] !== "1") {
  console.error(
    "demo:seed runs in simulator mode only (SIMULATOR=1). Use docs/sandbox-runbook.md for the sandbox.",
  );
  process.exit(1);
}
const token = process.env["API_TOKEN"];
const headers = {
  "content-type": "application/json",
  ...(token ? { authorization: `Bearer ${token}` } : {}),
};
const HOUR = 3_600_000;

const template = (name: string) =>
  DisputeSchema.parse(
    JSON.parse(readFileSync(join(root, "fixtures", "paypal", `dispute-${name}.json`), "utf8")),
  );

interface Story {
  label: string;
  template: string;
  dueInHours: number;
  /** Overrides on the fixture: reason, buyer message, or another fixture's transaction. */
  patch?: (d: Dispute) => Partial<Dispute>;
  /** What happens after triage. */
  then?: "win" | "lose";
}

const STORIES: Story[] = [
  {
    label: "Not received, good tracking: already WON",
    template: "not-received",
    dueInHours: 8 * 24,
    then: "win",
  },
  {
    label: "Not received, good tracking: FIGHT awaiting approval",
    template: "not-received",
    dueInHours: 9 * 24,
  },
  {
    label: "Not as described, listing changed after the order: OFFER",
    template: "not-as-described",
    dueInHours: 7 * 24,
  },
  {
    label: "$8.50 digital download: ACCEPT (fighting costs more)",
    template: "unauthorised",
    dueInHours: 6 * 24,
  },
  {
    label: "Unauthorised, repeat buyer with matching checkout: FIGHT",
    template: "not-received",
    dueInHours: 8 * 24,
    patch: () => ({
      reason: "UNAUTHORISED",
      messages: [
        {
          posted_by: "BUYER",
          time_posted: new Date().toISOString(),
          content: "I did not authorise this payment.",
        },
      ],
    }),
  },
  {
    label: "Not received, lost at PayPal: appeal drafted",
    template: "not-received",
    dueInHours: 5 * 24,
    then: "lose",
  },
  { label: "Due in under 6 hours: deadline safe default", template: "not-as-described", dueInHours: 5 },
];

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${apiUrl()}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

interface CaseRow {
  id: string;
  state: string;
  paypalDisputeId: string;
  latestDecision: { id: string; option: string; status: string } | null;
}

async function waitFor(
  disputeId: string,
  done: (c: CaseRow) => boolean,
  what: string,
  ms = 60_000,
): Promise<CaseRow> {
  const until = Date.now() + ms;
  for (;;) {
    const [c] = await api<CaseRow[]>(`/cases?q=${encodeURIComponent(disputeId)}&take=1`);
    if (c && done(c)) return c;
    if (Date.now() > until)
      throw new Error(`${disputeId}: timed out waiting for ${what} (state ${c?.state ?? "none"})`);
    await new Promise((r) => setTimeout(r, 750));
  }
}

async function open(story: Story): Promise<string> {
  const base = template(story.template);
  const now = new Date();
  const id = `PP-D-${randomInt(100000, 999999)}`;
  const dispute = client.sim.createDispute({
    ...base,
    ...(story.patch?.(base) ?? {}),
    dispute_id: id,
    create_time: now.toISOString(),
    update_time: now.toISOString(),
    seller_response_due_date: new Date(now.getTime() + story.dueInHours * HOUR).toISOString(),
    messages: (story.patch?.(base).messages ?? base.messages ?? []).map((m) => ({
      ...m,
      time_posted: now.toISOString(),
    })),
    links: [],
  });
  await postSimWebhook(client, "CUSTOMER.DISPUTE.CREATED", dispute);
  return id;
}

async function resolve(disputeId: string, side: "SELLER_FAVOR" | "BUYER_FAVOR"): Promise<void> {
  const c = await waitFor(disputeId, (x) => x.latestDecision?.status === "PROPOSED", "a proposed decision");
  await api(`/decisions/${c.latestDecision!.id}/approve`, {
    method: "POST",
    body: JSON.stringify({ approvedBy: "demo" }),
  });
  await waitFor(
    disputeId,
    (x) => ["FILED", "OFFER_PENDING", "WAITING_PAYPAL"].includes(x.state),
    "the filing",
  );
  await client.disputes.adjudicate(disputeId, side, `demo:adjudicate:${disputeId}`);
  await postSimWebhook(client, "CUSTOMER.DISPUTE.RESOLVED", await client.disputes.show(disputeId));
  await waitFor(
    disputeId,
    (x) => x.state === (side === "SELLER_FAVOR" ? "WON" : "LOST") || x.state === "APPEAL_DRAFTED",
    "the outcome",
  );
}

/** Deterministic pseudo-random numbers so a reseed produces the same history. */
function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
}

/**
 * 12 weeks of synthetic history: ~35 store orders a week (dispute rate around 1%) and resolved
 * DEMO-HIST cases with filings and outcomes. Ids are fixed, so rerunning updates nothing twice.
 */
async function backfill(db: Db): Promise<void> {
  const rand = rng(17);
  const now = Date.now();
  const orders = [];
  for (let day = 84; day >= 1; day--) {
    const perDay = 20 + Math.floor(rand() * 11);
    for (let i = 0; i < perDay; i++) {
      orders.push({
        id: `demo-hist-order-${day}-${i}`,
        status: "COMPLETED",
        placedAt: new Date(now - day * 24 * HOUR + Math.floor(rand() * 20) * HOUR),
        totalCents: 1800 + Math.floor(rand() * 14_000),
        currency: "USD",
      });
    }
  }
  await db.storeOrder.createMany({ data: orders, skipDuplicates: true });

  const reasons = [
    ["MERCHANDISE_OR_SERVICE_NOT_RECEIVED", 0.78],
    ["MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", 0.45],
    ["UNAUTHORISED", 0.7],
    ["CREDIT_NOT_PROCESSED", 0.3],
  ] as const;
  for (let i = 0; i < 26; i++) {
    const id = `DEMO-HIST-${String(i + 1).padStart(2, "0")}`;
    if (await db.case.findUnique({ where: { paypalDisputeId: id } })) continue;
    const [reason, winRate] = reasons[i % reasons.length]!;
    const opened = new Date(now - (82 - i * 3) * 24 * HOUR);
    const responded = new Date(opened.getTime() + (2 + rand() * 20) * HOUR);
    // Resolved in the past only: future-dated rows would distort the charts and the event stream.
    const resolved = new Date(Math.min(opened.getTime() + (9 + rand() * 12) * 24 * HOUR, now - 2 * HOUR));
    const amountCents = 2500 + Math.floor(rand() * 15_000);
    const offer = reason === "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED" && rand() < 0.5;
    const won = !offer && rand() < winRate;
    const state = offer ? "REFUNDED" : won ? "WON" : "LOST";
    const kind = offer ? "MAKE_OFFER" : "PROVIDE_EVIDENCE";
    await db.case.create({
      data: {
        paypalDisputeId: id,
        reason,
        status: "RESOLVED",
        stage: "INQUIRY",
        amountCents,
        currency: "USD",
        state,
        outcomeCode: offer
          ? "RESOLVED_WITH_PAYOUT"
          : won
            ? "RESOLVED_SELLER_FAVOUR"
            : "RESOLVED_BUYER_FAVOUR",
        sellerResponseDueAt: new Date(opened.getTime() + 10 * 24 * HOUR),
        disputedTransactions: [],
        messages: [],
        raw: { demo: "synthetic history for the dashboard" },
        paypalCreatedAt: opened,
        paypalUpdatedAt: resolved,
        createdAt: opened,
        events: {
          create: [
            { type: "CREATED", payload: { demo: true }, createdAt: opened },
            { type: "ACTION_SUCCEEDED", payload: { kind, demo: true }, createdAt: responded },
            {
              type: "OUTCOME",
              payload: {
                outcomeCode: offer
                  ? "RESOLVED_WITH_PAYOUT"
                  : won
                    ? "RESOLVED_SELLER_FAVOUR"
                    : "RESOLVED_BUYER_FAVOUR",
              },
              createdAt: resolved,
            },
          ],
        },
        actions: {
          create: {
            kind,
            endpoint: `demo:${kind}`,
            idempotencyKey: `${id}:demo:${kind}`,
            status: "SUCCEEDED",
            attempts: 1,
            request: offer ? { offerAmountCents: Math.round(amountCents * 0.4) } : { demo: true },
            createdAt: responded,
            completedAt: responded,
          },
        },
      },
    });
  }
  print(`history: ${orders.length} synthetic store orders, 26 resolved DEMO-HIST cases`);
}

const health = await fetch(`${apiUrl()}/healthz`).catch(() => null);
if (!health?.ok) {
  console.error(`The api at ${apiUrl()} is not running. Start it with: SIMULATOR=1 pnpm dev`);
  process.exit(1);
}
if (process.argv.includes("--reset")) {
  const db = createDb();
  try {
    // Local simulator data only: the guard above refuses to run outside SIMULATOR=1.
    await db.$executeRawUnsafe(
      `TRUNCATE "Action", "Decision", "EvidencePack", "EvidenceItem", "CaseEvent", "Notification", "SlaJob", "Message", "AgentRun", "Case", "WebhookEvent" CASCADE`,
    );
    await db.storeOrder.deleteMany({ where: { id: { startsWith: "demo-hist-order-" } } });
  } finally {
    await db.$disconnect();
  }
  client.sim.reset();
  print("reset: cases cleared, simulator state reseeded from fixtures");
}
if (process.argv.includes("--history")) {
  const db = createDb();
  try {
    await backfill(db);
  } finally {
    await db.$disconnect();
  }
}
const opened: [Story, string][] = [];
for (const story of STORIES) {
  const id = await open(story);
  opened.push([story, id]);
  print(`opened ${id}  ${story.label}`);
}
for (const [story, id] of opened) {
  const c = await waitFor(id, (x) => !!x.latestDecision, "triage");
  if (story.then) await resolve(id, story.then === "win" ? "SELLER_FAVOR" : "BUYER_FAVOR");
  const final = await waitFor(id, () => true, "state");
  print(`${id}  ${(c.latestDecision?.option ?? "-").padEnd(6)} ${final.state.padEnd(18)} ${story.label}`);
}
print("\nFor the live arrival during the video: pnpm sim:dispute not-received");
