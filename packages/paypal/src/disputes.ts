import type { OfferType, PayPalMoney } from "@rebuttal/core";
import type { HttpClient } from "./http.js";
import type { Logger } from "./logger.js";
import { assertDocumentsMatchFiles, buildMultipart, type EvidenceFile } from "./multipart.js";
import { LinksResponseSchema, type LinksResponse } from "./schemas/common.js";
import { DisputeListSchema, DisputeSchema, type Dispute, type DisputeSummary } from "./schemas/dispute.js";
import { TOOLKIT_LIST_PARAM_KEYS, type DisputesReader } from "./toolkit.js";

export interface ListDisputesParams {
  start_time?: string;
  update_time_after?: string;
  update_time_before?: string;
  dispute_state?: string;
  disputed_transaction_id?: string;
  page_size?: number;
  next_page_token?: string;
}

export interface DisputeListPage {
  items: DisputeSummary[];
  nextPageToken: string | undefined;
}

export interface TrackingInfo {
  carrier_name: string;
  carrier_name_other?: string;
  tracking_number: string;
  tracking_url?: string;
}

export interface EvidenceEntry {
  evidence_type: string;
  notes?: string;
  documents?: { name: string }[];
  evidence_info?: { tracking_info?: TrackingInfo[]; refund_ids?: string[] };
}

export interface EvidenceInput {
  evidences: EvidenceEntry[];
}

export interface MakeOfferInput {
  offer_type: OfferType;
  note: string;
  offer_amount?: PayPalMoney;
  return_shipping_address?: Record<string, string>;
  invoice_id?: string;
}

export interface AcceptClaimInput {
  note: string;
  accept_claim_reason?: string;
  accept_claim_type?: string;
  refund_amount?: PayPalMoney;
  return_shipping_address?: Record<string, string>;
  invoice_id?: string;
}

export interface AcknowledgeReturnItemInput {
  note: string;
  acknowledgement_type?: string;
}

export interface DisputesApi {
  list(params?: ListDisputesParams): Promise<DisputeListPage>;
  /** Pages through `next_page_token` until PayPal stops returning one. */
  listAll(params?: Omit<ListDisputesParams, "next_page_token">): AsyncGenerator<DisputeSummary>;
  show(disputeId: string): Promise<Dispute>;
  provideEvidence(
    disputeId: string,
    input: EvidenceInput,
    files: EvidenceFile[],
    idempotencyKey: string,
  ): Promise<LinksResponse>;
  appeal(
    disputeId: string,
    input: EvidenceInput,
    files: EvidenceFile[],
    idempotencyKey: string,
  ): Promise<LinksResponse>;
  provideSupportingInfo(
    disputeId: string,
    input: { notes: string },
    files: EvidenceFile[],
    idempotencyKey: string,
  ): Promise<LinksResponse>;
  makeOffer(disputeId: string, input: MakeOfferInput, idempotencyKey: string): Promise<LinksResponse>;
  acceptClaim(
    disputeId: string,
    input: AcceptClaimInput,
    idempotencyKey: string,
    file?: EvidenceFile,
  ): Promise<LinksResponse>;
  sendMessage(
    disputeId: string,
    input: { message: string },
    idempotencyKey: string,
    file?: EvidenceFile,
  ): Promise<LinksResponse>;
  acknowledgeReturnItem(
    disputeId: string,
    input: AcknowledgeReturnItemInput,
    idempotencyKey: string,
    file?: EvidenceFile,
  ): Promise<LinksResponse>;
  /** Sandbox only: move a dispute to the evidence-required state. */
  requireEvidence(
    disputeId: string,
    action: "SELLER_EVIDENCE" | "BUYER_EVIDENCE",
    idempotencyKey: string,
  ): Promise<LinksResponse>;
  /** Sandbox only: settle a dispute in one party's favour. */
  adjudicate(
    disputeId: string,
    outcome: "SELLER_FAVOR" | "BUYER_FAVOR",
    idempotencyKey: string,
  ): Promise<LinksResponse>;
}

const DISPUTE_ID = /^[A-Za-z0-9-]{1,255}$/;

export function disputePath(disputeId: string, action?: string): string {
  if (!DISPUTE_ID.test(disputeId)) throw new Error(`Invalid PayPal dispute id: ${disputeId}`);
  return `/v1/customer/disputes/${disputeId}${action ? `/${action}` : ""}`;
}

export function nextPageToken(links: { href: string; rel: string }[] | undefined): string | undefined {
  const next = links?.find((l) => l.rel === "next");
  if (!next) return undefined;
  try {
    return (
      new URL(next.href, "https://api-m.sandbox.paypal.com").searchParams.get("next_page_token") ?? undefined
    );
  } catch {
    return undefined;
  }
}

function toolkitCanServe(params: ListDisputesParams): boolean {
  return Object.entries(params).every(([k, v]) => v === undefined || TOOLKIT_LIST_PARAM_KEYS.includes(k));
}

export function createDisputesApi(http: HttpClient, log: Logger, reader?: DisputesReader): DisputesApi {
  /** Try the toolkit first; any failure falls back to REST with the same validation. */
  async function viaReader<T>(
    op: string,
    call: (r: DisputesReader) => Promise<unknown>,
    parse: (d: unknown) => T,
    rest: () => Promise<T>,
  ): Promise<T> {
    if (!reader) return rest();
    try {
      return parse(await call(reader));
    } catch (err) {
      log.warn(
        { op, reader: reader.name, err: err instanceof Error ? err.message : String(err) },
        "toolkit read failed; using REST",
      );
      return rest();
    }
  }

  const write = (
    disputeId: string,
    action: string,
    idempotencyKey: string,
    body: { json?: unknown; form?: FormData },
  ) =>
    http.request({
      method: "POST",
      path: disputePath(disputeId, action),
      idempotencyKey,
      schema: LinksResponseSchema,
      ...body,
    });

  const evidenceWrite = (
    disputeId: string,
    action: string,
    input: EvidenceInput,
    files: EvidenceFile[],
    idempotencyKey: string,
  ) => {
    if (!input.evidences.length) throw new Error(`${action} needs at least one evidence entry`);
    assertDocumentsMatchFiles(
      input.evidences.flatMap((e) => e.documents?.map((d) => d.name) ?? []),
      files,
    );
    return write(disputeId, action, idempotencyKey, { form: buildMultipart(input, files, "evidence-file") });
  };

  /** JSON when there is no attachment, otherwise multipart with the JSON in `input`. */
  const optionalFileWrite = (
    disputeId: string,
    action: string,
    input: object,
    idempotencyKey: string,
    filePart: string,
    file?: EvidenceFile,
  ) =>
    write(
      disputeId,
      action,
      idempotencyKey,
      file ? { form: buildMultipart(input, [file], filePart) } : { json: input },
    );

  const api: DisputesApi = {
    async list(params = {}) {
      const rest = async () => {
        const data = await http.request({
          method: "GET",
          path: "/v1/customer/disputes",
          query: { ...params },
          schema: DisputeListSchema,
        });
        return { items: data.items, nextPageToken: nextPageToken(data.links) };
      };
      if (!toolkitCanServe(params)) return rest();
      return viaReader(
        "list",
        (r) => r.list(params),
        (d) => {
          const data = DisputeListSchema.parse(d);
          return { items: data.items, nextPageToken: nextPageToken(data.links) };
        },
        rest,
      );
    },

    async *listAll(params = {}) {
      let token: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await api.list({
          page_size: 50,
          ...params,
          ...(token ? { next_page_token: token } : {}),
        });
        yield* page.items;
        token = page.nextPageToken;
        if (token && seen.has(token)) break; // defensive: never loop on a repeated token
        if (token) seen.add(token);
      } while (token);
    },

    show(disputeId) {
      const path = disputePath(disputeId);
      return viaReader(
        "show",
        (r) => r.show(disputeId),
        (d) => DisputeSchema.parse(d),
        () => http.request({ method: "GET", path, schema: DisputeSchema }),
      );
    },

    provideEvidence: (id, input, files, key) => evidenceWrite(id, "provide-evidence", input, files, key),
    appeal: (id, input, files, key) => evidenceWrite(id, "appeal", input, files, key),
    provideSupportingInfo: (id, input, files, key) =>
      write(id, "provide-supporting-info", key, {
        form: buildMultipart(input, files, "supporting-document"),
      }),

    makeOffer(id, input, key) {
      if (input.offer_type !== "REPLACEMENT_WITHOUT_REFUND" && !input.offer_amount) {
        throw new Error(`${input.offer_type} offers need an offer_amount`);
      }
      return write(id, "make-offer", key, { json: input });
    },
    acceptClaim: (id, input, key, file) =>
      optionalFileWrite(id, "accept-claim", input, key, "accept-claim-document", file),
    sendMessage: (id, input, key, file) =>
      optionalFileWrite(id, "send-message", input, key, "message_document", file),
    acknowledgeReturnItem: (id, input, key, file) =>
      optionalFileWrite(id, "acknowledge-return-item", input, key, "acknowledgement_document", file),

    requireEvidence: (id, action, key) => write(id, "require-evidence", key, { json: { action } }),
    adjudicate: (id, outcome, key) =>
      write(id, "adjudicate", key, { json: { adjudication_outcome: outcome } }),
  };
  return api;
}
