import { Policy, policyFrom, type EvidenceLike } from "@rebuttal/core";
import { ACCEPT_NOTE, decideCase, fightNote, offerNote, toDecisionAnalysis } from "@rebuttal/decision";
import { Prisma, type Db } from "./index.js";
import { seedStoreData, type StoreSeedResult } from "./store-seed.js";

export const DEMO_SEED_CASE_IDS = [
  "demo-seed-case-gathering",
  "demo-seed-case-approval",
  "demo-seed-case-urgent",
  "demo-seed-case-won",
  "demo-seed-case-lost",
] as const;

export const DEMO_SEED_POLICY = Policy.parse({
  autonomy: { enabled: false },
  deadlineAutoApproveHours: 0,
  llm: { enabled: false },
  winModel: "hand",
});

const json = (value: unknown) => value as Prisma.InputJsonValue;

interface DemoCaseSpec {
  id: (typeof DEMO_SEED_CASE_IDS)[number];
  paypalDisputeId: string;
  reason: string;
  status: string;
  stage: string;
  state: Prisma.CaseCreateManyInput["state"];
  amountCents: number;
  currency: string;
  dueInHours: number | null;
  createdDaysAgo: number;
  outcomeCode?: string;
  item: string;
  buyer: string;
}

interface SeedEvidence extends EvidenceLike {
  id: string;
  caseId: string;
  title: string;
  capturedAt: Date;
}

const DEMO_CASES: DemoCaseSpec[] = [
  {
    id: "demo-seed-case-gathering",
    paypalDisputeId: "DEMO-PP-C-GATHERING-01",
    reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    status: "WAITING_FOR_SELLER_RESPONSE",
    stage: "INQUIRY",
    state: "GATHERING",
    amountCents: 7450,
    currency: "USD",
    dueInHours: 120,
    createdDaysAgo: 1,
    item: "Speckled serving bowl",
    buyer: "Demo Buyer R",
  },
  {
    id: "demo-seed-case-approval",
    paypalDisputeId: "DEMO-PP-C-APPROVAL-02",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    status: "WAITING_FOR_SELLER_RESPONSE",
    stage: "CHARGEBACK",
    state: "AWAITING_APPROVAL",
    amountCents: 12900,
    currency: "USD",
    dueInHours: 72,
    createdDaysAgo: 2,
    item: "Linen field jacket",
    buyer: "Demo Buyer M",
  },
  {
    id: "demo-seed-case-urgent",
    paypalDisputeId: "DEMO-PP-C-URGENT-03",
    reason: "UNAUTHORISED",
    status: "WAITING_FOR_SELLER_RESPONSE",
    stage: "CHARGEBACK",
    state: "AWAITING_APPROVAL",
    amountCents: 21900,
    currency: "USD",
    dueInHours: 10,
    createdDaysAgo: 5,
    item: "Hand-thrown table set",
    buyer: "Demo Buyer A",
  },
  {
    id: "demo-seed-case-won",
    paypalDisputeId: "DEMO-PP-C-WON-04",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    status: "RESOLVED",
    stage: "ARBITRATION",
    state: "WON",
    amountCents: 19900,
    currency: "JPY",
    dueInHours: null,
    createdDaysAgo: 28,
    outcomeCode: "RESOLVED_SELLER_FAVOUR",
    item: "Digital weaving course",
    buyer: "Demo Buyer K",
  },
  {
    id: "demo-seed-case-lost",
    paypalDisputeId: "DEMO-PP-C-LOST-05",
    reason: "DUPLICATE_TRANSACTION",
    status: "RESOLVED",
    stage: "ARBITRATION",
    state: "LOST",
    amountCents: 5600,
    currency: "USD",
    dueInHours: null,
    createdDaysAgo: 35,
    outcomeCode: "RESOLVED_BUYER_FAVOUR",
    item: "Botanical print pair",
    buyer: "Demo Buyer T",
  },
];

const at = (now: Date, offsetMs: number) => new Date(now.getTime() + offsetMs);
const hours = (count: number) => count * 3_600_000;
const days = (count: number) => count * 86_400_000;

function evidenceFor(spec: DemoCaseSpec, now: Date): SeedEvidence[] {
  const capturedAt = at(now, -hours(2));
  const item = (
    suffix: string,
    source: string,
    type: string,
    title: string,
    data: Record<string, unknown>,
  ): SeedEvidence => ({
    id: `demo-seed-evidence-${spec.id}-${suffix}`,
    caseId: spec.id,
    source,
    type,
    title,
    data,
    capturedAt,
  });

  const order = item("order", "demo-store", "ORDER_DETAILS", "Synthetic store order", {
    kind: "order",
    orderId: `DEMO-ORDER-${spec.paypalDisputeId}`,
    placedAt: at(now, -days(spec.createdDaysAgo + 7)).toISOString(),
    items: [{ name: spec.item, sku: `DEMO-${spec.id}`, digital: spec.id.endsWith("won") }],
    totalCents: spec.amountCents,
    agreedAmountCents: spec.amountCents,
    distinctFromOtherCharge: spec.id.endsWith("lost") ? false : true,
    singlePaymentMethod: true,
  });

  if (spec.id.endsWith("gathering")) return [order];
  if (spec.id.endsWith("lost")) return [order];
  if (spec.id.endsWith("won"))
    return [
      order,
      item("access", "demo-store", "PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED", "Synthetic access log", {
        kind: "access_log",
        accessCount: 4,
        accessedAfterPurchase: true,
        ipMatchesCheckout: true,
        events: [{ at: at(now, -days(25)).toISOString(), action: "download" }],
      }),
    ];
  if (spec.id.endsWith("urgent"))
    return [
      order,
      item("tracking", "demo-carrier", "PROOF_OF_FULFILLMENT", "Synthetic delivery record", {
        kind: "carrier_tracking",
        status: "delivered",
        deliveredTo: { zip: "94107" },
        shippingPostalCode: "94107",
        signedBy: "Demo recipient",
      }),
      item("history", "demo-store", "OTHER", "Synthetic buyer history", {
        kind: "buyer_history",
        priorOrders: 4,
        priorDisputes: 0,
      }),
      item("risk", "demo-store", "ORDER_DETAILS", "Synthetic checkout verification", {
        kind: "checkout_risk",
        avsMatch: true,
        cvvMatch: true,
        ipMatch: true,
        deviceMatch: true,
      }),
    ];

  return [
    order,
    item("tracking", "demo-carrier", "PROOF_OF_FULFILLMENT", "Synthetic delivery record", {
      kind: "carrier_tracking",
      status: "delivered",
      deliveredTo: { zip: "10001" },
      shippingPostalCode: "10001",
      signedBy: "Demo recipient",
    }),
    item("messages", "demo-store", "OTHER", "Synthetic buyer-seller thread", {
      kind: "message_thread",
      sellerReplied: true,
      messages: [],
    }),
  ];
}

function caseRow(spec: DemoCaseSpec, now: Date): Prisma.CaseCreateManyInput {
  const paypalCreatedAt = at(now, -days(spec.createdDaysAgo));
  const placedAt = at(now, -days(spec.createdDaysAgo + 7));
  return {
    id: spec.id,
    merchantId: "default",
    paypalDisputeId: spec.paypalDisputeId,
    reason: spec.reason,
    status: spec.status,
    disputeState: spec.status,
    stage: spec.stage,
    channel: "INTERNAL",
    amountCents: spec.amountCents,
    currency: spec.currency,
    sellerResponseDueAt: spec.dueInHours === null ? null : at(now, hours(spec.dueInHours)),
    buyerResponseDueAt: null,
    state: spec.state,
    outcomeCode: spec.outcomeCode ?? null,
    withdrawn: false,
    sellerTransactionId: `DEMO-CAPTURE-${spec.id}`,
    disputedTransactions: json([
      {
        sellerTransactionId: `DEMO-CAPTURE-${spec.id}`,
        buyerTransactionId: null,
        grossAmount: { cents: spec.amountCents, currency: spec.currency },
        createdAt: placedAt.toISOString(),
        invoiceNumber: `DEMO-INV-${spec.id}`,
        buyerName: spec.buyer,
        items: [{ name: spec.item, quantity: "1" }],
      },
    ]),
    messages: json([]),
    allowedResponseOptions: Prisma.JsonNull,
    transactionContext: Prisma.JsonNull,
    raw: json({ demoSeed: true, synthetic: true }),
    paypalCreatedAt,
    paypalUpdatedAt: paypalCreatedAt,
    createdAt: paypalCreatedAt,
    updatedAt: paypalCreatedAt,
  };
}

function decisionRow(
  spec: DemoCaseSpec,
  evidence: SeedEvidence[],
  policy: typeof DEMO_SEED_POLICY,
  now: Date,
): Prisma.DecisionCreateManyInput | null {
  if (spec.state === "GATHERING") return null;
  const createdAt = at(now, -days(Math.min(spec.createdDaysAgo, 7)));
  const result = decideCase({
    c: {
      paypalDisputeId: spec.paypalDisputeId,
      reason: spec.reason,
      stage: spec.stage,
      amount: { cents: spec.amountCents, currency: spec.currency },
      sellerResponseDueAt: spec.dueInHours === null ? null : at(now, hours(spec.dueInHours)).toISOString(),
      paypalCreatedAt: at(now, -days(spec.createdDaysAgo)).toISOString(),
      disputedTransactions: [{ createdAt: at(now, -days(spec.createdDaysAgo + 7)).toISOString() }],
    },
    evidence,
    policy,
    now,
  });
  const analysis = toDecisionAnalysis(result, { exhibits: [], triage: null });
  const note =
    result.option === "FIGHT"
      ? fightNote([])
      : result.option === "OFFER"
        ? offerNote(result.offerType ?? "REFUND", {
            cents: result.offerAmountCents ?? 0,
            currency: spec.currency,
          })
        : ACCEPT_NOTE;

  return {
    id: `demo-seed-decision-${spec.id}`,
    caseId: spec.id,
    option: result.option,
    status: spec.state === "WON" || spec.state === "LOST" ? "EXECUTED" : "PROPOSED",
    pWin: result.decision.pWin,
    evFight: result.decision.evFight,
    evOffer: result.decision.offer?.evCents ?? null,
    evAccept: result.decision.evAccept,
    offerAmountCents: result.offerAmountCents,
    offerType: result.offerType,
    note,
    rationale: analysis.rationale.join(". "),
    reason: null,
    modelVersion: analysis.engineVersion,
    analysis: json(analysis),
    narrative: Prisma.JsonNull,
    approvedBy: null,
    approvedAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

export interface DemoSeedResult extends StoreSeedResult {
  merchantCreated: boolean;
  policyCreated: boolean;
  casesAdded: number;
  evidenceAdded: number;
  decisionsAdded: number;
}

/** Idempotent demo-only seed. Existing rows—including an edited policy—are never updated. */
export async function seedDemoData(db: Db, now = new Date()): Promise<DemoSeedResult> {
  return db.$transaction(async (tx) => {
    const merchant = await tx.merchant.findUnique({ where: { id: "default" } });
    if (!merchant)
      await tx.merchant.create({
        data: {
          id: "default",
          name: "Fern & Field Goods",
          defaultCurrency: "USD",
          createdAt: now,
          updatedAt: now,
        },
      });

    const storedPolicy = await tx.policy.findUnique({ where: { id: "default" } });
    if (!storedPolicy)
      await tx.policy.create({
        data: {
          id: "default",
          merchantId: "default",
          config: json(DEMO_SEED_POLICY),
          updatedBy: "demo-seed",
          updatedAt: now,
        },
      });
    const activePolicy = policyFrom(storedPolicy?.config ?? DEMO_SEED_POLICY);

    const cases = DEMO_CASES.map((spec) => caseRow(spec, now));
    const evidence = DEMO_CASES.flatMap((spec) => evidenceFor(spec, now));
    const decisions = DEMO_CASES.flatMap((spec) => {
      const decision = decisionRow(
        spec,
        evidence.filter((item) => item.caseId === spec.id),
        activePolicy,
        now,
      );
      return decision ? [decision] : [];
    });

    const createdCases = await tx.case.createMany({ data: cases, skipDuplicates: true });
    const createdEvidence = await tx.evidenceItem.createMany({
      data: evidence.map((item) => ({
        id: item.id,
        caseId: item.caseId,
        source: item.source,
        type: item.type,
        title: item.title,
        dedupeKey: item.id,
        data: json(item.data),
        capturedAt: item.capturedAt,
        createdAt: item.capturedAt,
      })),
      skipDuplicates: true,
    });
    const createdDecisions = await tx.decision.createMany({ data: decisions, skipDuplicates: true });
    const store = await seedStoreData(tx);

    return {
      merchantCreated: !merchant,
      policyCreated: !storedPolicy,
      casesAdded: createdCases.count,
      evidenceAdded: createdEvidence.count,
      decisionsAdded: createdDecisions.count,
      ...store,
    };
  });
}
