import type { PayPalMoney } from "@rebuttal/core";
import type { HttpClient } from "./http.js";
import { LinksResponseSchema, type LinksResponse } from "./schemas/common.js";
import {
  CaptureSchema,
  OrderSchema,
  RefundSchema,
  type Capture,
  type Order,
  type Refund,
} from "./schemas/orders.js";

const ID = /^[A-Za-z0-9-]{1,64}$/;
function id(value: string, what: string): string {
  if (!ID.test(value)) throw new Error(`Invalid PayPal ${what} id: ${value}`);
  return value;
}

export interface AddTrackingInput {
  capture_id: string;
  tracking_number: string;
  /** PayPal carrier enum, e.g. USPS, UPS, FEDEX, DHL, or OTHER with `carrier_name_other`. */
  carrier: string;
  carrier_name_other?: string;
  notify_payer?: boolean;
}

export interface OrdersApi {
  get(orderId: string): Promise<Order>;
  /** POST /v2/checkout/orders/{id}/track */
  addTracking(orderId: string, input: AddTrackingInput, idempotencyKey: string): Promise<LinksResponse>;
}

export interface RefundInput {
  /** Omit for a full refund. */
  amount?: PayPalMoney;
  note_to_payer?: string;
  invoice_id?: string;
}

export interface PaymentsApi {
  getCapture(captureId: string): Promise<Capture>;
  /** POST /v2/payments/captures/{id}/refund, for proactive refunds outside a dispute. */
  refund(captureId: string, input: RefundInput, idempotencyKey: string): Promise<Refund>;
}

export function createOrdersApi(http: HttpClient): OrdersApi {
  return {
    get: (orderId) =>
      http.request({
        method: "GET",
        path: `/v2/checkout/orders/${id(orderId, "order")}`,
        schema: OrderSchema,
      }),
    addTracking: (orderId, input, idempotencyKey) =>
      http.request({
        method: "POST",
        path: `/v2/checkout/orders/${id(orderId, "order")}/track`,
        idempotencyKey,
        json: input,
        // PayPal returns the updated order here; we only need the links.
        schema: LinksResponseSchema,
      }),
  };
}

export function createPaymentsApi(http: HttpClient): PaymentsApi {
  return {
    getCapture: (captureId) =>
      http.request({
        method: "GET",
        path: `/v2/payments/captures/${id(captureId, "capture")}`,
        schema: CaptureSchema,
      }),
    refund: (captureId, input, idempotencyKey) =>
      http.request({
        method: "POST",
        path: `/v2/payments/captures/${id(captureId, "capture")}/refund`,
        idempotencyKey,
        json: input,
        headers: { Prefer: "return=representation" },
        schema: RefundSchema,
      }),
  };
}
