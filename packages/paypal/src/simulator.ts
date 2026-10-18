import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { PayPalClient } from "./client.js";
import type { DisputeListPage, DisputesApi, EvidenceInput, ListDisputesParams } from "./disputes.js";
import { disputePath } from "./disputes.js";
import { PayPalError } from "./errors.js";
import { validateEvidenceFiles, type EvidenceFile } from "./multipart.js";
import type { OrdersApi, PaymentsApi } from "./orders.js";
import type { LinksResponse } from "./schemas/common.js";
import { DisputeSchema, type Dispute, type DisputeSummary } from "./schemas/dispute.js";
import { CaptureSchema, OrderSchema, type Capture, type Order, type Refund } from "./schemas/orders.js";
import type { WebhooksApi } from "./webhooks.js";

export interface SimulatorState {
  disputes: Record<string, Dispute>;
  captures: Record<string, Capture>;
  orders: Record<string, Order>;
  /** Responses by PayPal-Request-Id, so a repeated key replays instead of re-applying. */
  writes: Record<string, { endpoint: string; response: unknown }>;
  /** Every write call received, including replays; tests use this to count calls. */
  calls: { endpoint: string; idempotencyKey: string; at: string }[];
}

export interface SimulatorOptions {
  /** Directory with dispute-*.json, capture-*.json, order-*.json. Default: <repo>/fixtures/paypal */
  fixturesDir?: string;
  /** JSON file shared by api and worker processes. Default: <repo>/.sim/state.json */
  stateFile?: string;
  now?: () => Date;
}

export interface SimulatorClient extends PayPalClient {
  readonly mode: "simulator";
  sim: {
    /** Adds a dispute (and optionally its capture/order) as if a buyer just opened it. */
    createDispute(dispute: Dispute, extra?: { capture?: Capture; order?: Order }): Dispute;
    state(): SimulatorState;
    reset(): void;
  };
}

/** Walks up from cwd to the directory holding pnpm-workspace.yaml. */
export function findRepoRoot(start = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

function seedState(fixturesDir: string): SimulatorState {
  const state: SimulatorState = { disputes: {}, captures: {}, orders: {}, writes: {}, calls: [] };
  if (!existsSync(fixturesDir)) return state;
  for (const file of readdirSync(fixturesDir)) {
    if (!file.endsWith(".json")) continue;
    const json: unknown = JSON.parse(readFileSync(join(fixturesDir, file), "utf8"));
    if (file.startsWith("dispute-")) {
      const d = DisputeSchema.parse(json);
      state.disputes[d.dispute_id] = d;
    } else if (file.startsWith("capture-")) {
      const c = CaptureSchema.parse(json);
      state.captures[c.id] = c;
    } else if (file.startsWith("order-")) {
      const o = OrderSchema.parse(json);
      state.orders[o.id] = o;
    }
  }
  return state;
}

function notFound(method: string, path: string): PayPalError {
  return new PayPalError({
    status: 404,
    name: "RESOURCE_NOT_FOUND",
    message: "The specified resource does not exist.",
    method,
    path,
  });
}

function unprocessable(path: string, issue: string, message: string): PayPalError {
  return new PayPalError({
    status: 422,
    name: "UNPROCESSABLE_ENTITY",
    message:
      "The requested action could not be performed, semantically incorrect, or failed business validation.",
    details: [{ issue, description: message }],
    method: "POST",
    path,
  });
}

/**
 * Offline stand-in for PayPal behind the same `PayPalClient` interface (`SIMULATOR=1`).
 * State lives in a JSON file so the api and worker processes see the same disputes.
 */
export function createSimulatorClient(opts: SimulatorOptions = {}): SimulatorClient {
  const root = findRepoRoot();
  const fixturesDir = opts.fixturesDir ?? join(root, "fixtures", "paypal");
  const stateFile = opts.stateFile ?? join(root, ".sim", "state.json");
  const now = opts.now ?? (() => new Date());

  const load = (): SimulatorState => {
    if (!existsSync(stateFile)) {
      const seeded = seedState(fixturesDir);
      save(seeded);
      return seeded;
    }
    return JSON.parse(readFileSync(stateFile, "utf8")) as SimulatorState;
  };
  const save = (s: SimulatorState) => {
    mkdirSync(dirname(stateFile), { recursive: true });
    const tmp = `${stateFile}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(s, null, 2));
    renameSync(tmp, stateFile);
  };

  const getDispute = (s: SimulatorState, id: string, method = "GET"): Dispute => {
    const d = s.disputes[id];
    if (!d) throw notFound(method, disputePath(id));
    return d;
  };

  const links = (id: string): LinksResponse => ({
    links: [{ href: `https://api-m.sandbox.paypal.com${disputePath(id)}`, rel: "self", method: "GET" }],
  });

  /** Applies a write once per idempotency key, like PayPal's PayPal-Request-Id handling. */
  function write<T>(endpoint: string, idempotencyKey: string, apply: (s: SimulatorState) => T): T {
    const s = load();
    s.calls.push({ endpoint, idempotencyKey, at: now().toISOString() });
    const previous = s.writes[idempotencyKey];
    if (previous) {
      save(s);
      return previous.response as T;
    }
    const response = apply(s);
    s.writes[idempotencyKey] = { endpoint, response };
    save(s);
    return response;
  }

  const touch = (d: Dispute, patch: Partial<Dispute>) =>
    Object.assign(d, patch, { update_time: now().toISOString() });

  const requireStatus = (d: Dispute, path: string, ...allowed: string[]) => {
    if (!allowed.includes(d.status)) {
      throw unprocessable(
        path,
        "DISPUTE_NOT_IN_REQUIRED_STATE",
        `Dispute is ${d.status}; needs ${allowed.join(" or ")}`,
      );
    }
  };
  const requireOpen = (d: Dispute, path: string) => {
    if (d.status === "RESOLVED") throw unprocessable(path, "DISPUTE_RESOLVED", "Dispute is already resolved");
  };

  const evidenceWrite = (
    action: string,
    id: string,
    input: EvidenceInput,
    files: EvidenceFile[],
    key: string,
  ) => {
    validateEvidenceFiles(files);
    const path = disputePath(id, action);
    return write(path, key, (s) => {
      const d = getDispute(s, id, "POST");
      if (action === "provide-evidence") requireStatus(d, path, "WAITING_FOR_SELLER_RESPONSE");
      if (action === "appeal" && d.status !== "RESOLVED")
        throw unprocessable(path, "NOT_APPEALABLE", "Only resolved disputes can be appealed");
      const submitted = input.evidences.map((e) => ({
        ...e,
        source: "SUBMITTED_BY_SELLER",
        date: now().toISOString(),
      }));
      touch(d, {
        status: "UNDER_REVIEW",
        evidences: [...(d.evidences ?? []), ...submitted],
        ...(action === "appeal" ? { dispute_outcome: undefined } : {}),
      });
      return links(id);
    });
  };

  const disputes: DisputesApi = {
    async list(params: ListDisputesParams = {}): Promise<DisputeListPage> {
      const pageSize = params.page_size ?? 10;
      const offset = params.next_page_token
        ? Number(Buffer.from(params.next_page_token, "base64").toString())
        : 0;
      const all = Object.values(load().disputes)
        .filter((d) => !params.start_time || d.create_time >= params.start_time)
        .filter((d) => !params.update_time_after || d.update_time >= params.update_time_after)
        .filter((d) => !params.update_time_before || d.update_time < params.update_time_before)
        .filter((d) => !params.dispute_state || (d.dispute_state ?? "") === params.dispute_state)
        .sort((a, b) => a.create_time.localeCompare(b.create_time));
      const items: DisputeSummary[] = all.slice(offset, offset + pageSize).map((d) => ({
        dispute_id: d.dispute_id,
        create_time: d.create_time,
        update_time: d.update_time,
        reason: d.reason,
        status: d.status,
        dispute_amount: d.dispute_amount,
        dispute_life_cycle_stage: d.dispute_life_cycle_stage,
        ...(d.seller_response_due_date ? { seller_response_due_date: d.seller_response_due_date } : {}),
      }));
      const more = offset + pageSize < all.length;
      return {
        items,
        nextPageToken: more ? Buffer.from(String(offset + pageSize)).toString("base64") : undefined,
      };
    },
    async *listAll(params = {}) {
      let token: string | undefined;
      do {
        const page = await disputes.list({
          page_size: 50,
          ...params,
          ...(token ? { next_page_token: token } : {}),
        });
        yield* page.items;
        token = page.nextPageToken;
      } while (token);
    },
    async show(id) {
      return structuredClone(getDispute(load(), id));
    },
    provideEvidence: async (id, input, files, key) =>
      evidenceWrite("provide-evidence", id, input, files, key),
    appeal: async (id, input, files, key) => evidenceWrite("appeal", id, input, files, key),
    async provideSupportingInfo(id, input, files, key) {
      validateEvidenceFiles(files);
      return write(disputePath(id, "provide-supporting-info"), key, (s) => {
        touch(getDispute(s, id, "POST"), {});
        return links(id);
      });
    },
    async makeOffer(id, input, key) {
      const path = disputePath(id, "make-offer");
      return write(path, key, (s) => {
        const d = getDispute(s, id, "POST");
        requireOpen(d, path);
        if (d.dispute_life_cycle_stage !== "INQUIRY")
          throw unprocessable(path, "OFFER_NOT_ALLOWED", "Offers are only allowed in the INQUIRY stage");
        touch(d, {
          status: "WAITING_FOR_BUYER_RESPONSE",
          offer: {
            offer_type: input.offer_type,
            ...(input.offer_amount ? { seller_offered_amount: input.offer_amount } : {}),
          },
        });
        return links(id);
      });
    },
    async acceptClaim(id, input, key) {
      const path = disputePath(id, "accept-claim");
      return write(path, key, (s) => {
        const d = getDispute(s, id, "POST");
        requireOpen(d, path);
        touch(d, {
          status: "RESOLVED",
          dispute_state: "RESOLVED",
          dispute_outcome: {
            outcome_code: "RESOLVED_BUYER_FAVOUR",
            amount_refunded: input.refund_amount ?? d.dispute_amount,
          },
        });
        return links(id);
      });
    },
    async sendMessage(id, input, key) {
      const path = disputePath(id, "send-message");
      return write(path, key, (s) => {
        const d = getDispute(s, id, "POST");
        requireOpen(d, path);
        touch(d, {
          messages: [
            ...(d.messages ?? []),
            { posted_by: "SELLER", time_posted: now().toISOString(), content: input.message },
          ],
        });
        return links(id);
      });
    },
    async acknowledgeReturnItem(id, _input, key) {
      const path = disputePath(id, "acknowledge-return-item");
      return write(path, key, (s) => {
        const d = getDispute(s, id, "POST");
        requireOpen(d, path);
        touch(d, { status: "UNDER_REVIEW" });
        return links(id);
      });
    },
    async requireEvidence(id, action, key) {
      return write(disputePath(id, "require-evidence"), key, (s) => {
        const d = getDispute(s, id, "POST");
        const due = new Date(now().getTime() + 10 * 24 * 3600 * 1000).toISOString();
        touch(
          d,
          action === "SELLER_EVIDENCE"
            ? {
                status: "WAITING_FOR_SELLER_RESPONSE",
                dispute_state: "REQUIRED_ACTION",
                seller_response_due_date: due,
              }
            : {
                status: "WAITING_FOR_BUYER_RESPONSE",
                dispute_state: "REQUIRED_OTHER_PARTY_ACTION",
                buyer_response_due_date: due,
              },
        );
        return links(id);
      });
    },
    async adjudicate(id, outcome, key) {
      return write(disputePath(id, "adjudicate"), key, (s) => {
        const d = getDispute(s, id, "POST");
        touch(d, {
          status: "RESOLVED",
          dispute_state: "RESOLVED",
          dispute_outcome:
            outcome === "SELLER_FAVOR"
              ? { outcome_code: "RESOLVED_SELLER_FAVOUR" }
              : { outcome_code: "RESOLVED_BUYER_FAVOUR", amount_refunded: d.dispute_amount },
        });
        return links(id);
      });
    },
  };

  const orders: OrdersApi = {
    async get(orderId) {
      const o = load().orders[orderId];
      if (!o) throw notFound("GET", `/v2/checkout/orders/${orderId}`);
      return structuredClone(o);
    },
    async addTracking(orderId, input, key) {
      return write(`/v2/checkout/orders/${orderId}/track`, key, (s) => {
        const o = s.orders[orderId];
        if (!o) throw notFound("POST", `/v2/checkout/orders/${orderId}/track`);
        const unit = o.purchase_units[0];
        if (unit) {
          unit.shipping ??= {};
          unit.shipping.trackers = [
            ...(unit.shipping.trackers ?? []),
            { id: `${input.capture_id}-${input.tracking_number}`, status: "SHIPPED" },
          ];
        }
        return { links: [] };
      });
    },
  };

  const payments: PaymentsApi = {
    async getCapture(captureId) {
      const c = load().captures[captureId];
      if (!c) throw notFound("GET", `/v2/payments/captures/${captureId}`);
      return structuredClone(c);
    },
    async refund(captureId, input, key) {
      return write(`/v2/payments/captures/${captureId}/refund`, key, (s): Refund => {
        const c = s.captures[captureId];
        if (!c) throw notFound("POST", `/v2/payments/captures/${captureId}/refund`);
        c.status = input.amount ? "PARTIALLY_REFUNDED" : "REFUNDED";
        return {
          id: `SIMREFUND${randomUUID().slice(0, 8).toUpperCase()}`,
          status: "COMPLETED",
          ...(input.amount ? { amount: input.amount } : c.amount ? { amount: c.amount } : {}),
        };
      });
    },
  };

  const webhooks: WebhooksApi = {
    // Synthetic webhooks from `pnpm sim:dispute` are unsigned.
    async verifySignature() {
      return true;
    },
  };

  return {
    mode: "simulator",
    disputes,
    orders,
    payments,
    webhooks,
    async ping() {},
    sim: {
      createDispute(dispute, extra) {
        const s = load();
        const d = DisputeSchema.parse(dispute);
        s.disputes[d.dispute_id] = d;
        if (extra?.capture) s.captures[extra.capture.id] = extra.capture;
        if (extra?.order) s.orders[extra.order.id] = extra.order;
        save(s);
        return d;
      },
      state: load,
      reset() {
        save(seedState(fixturesDir));
      },
    },
  };
}
