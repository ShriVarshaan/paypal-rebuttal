import { z } from "zod";
import { LinkSchema, PayPalMoneySchema } from "./common.js";

// Field names follow openapi/customer_disputes_v1.json. Objects are loose so new PayPal
// fields pass through, and enums are plain strings so a new value never breaks sync.

export const DisputeTransactionSchema = z.looseObject({
  buyer_transaction_id: z.string().optional(),
  seller_transaction_id: z.string().optional(),
  reference_id: z.string().optional(),
  create_time: z.string().optional(),
  transaction_status: z.string().optional(),
  gross_amount: PayPalMoneySchema.optional(),
  invoice_number: z.string().optional(),
  custom: z.string().optional(),
  buyer: z.looseObject({ name: z.string().optional() }).optional(),
  seller: z
    .looseObject({
      email: z.string().optional(),
      merchant_id: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  items: z
    .array(
      z.looseObject({
        item_id: z.string().optional(),
        item_description: z.string().optional(),
        item_quantity: z.string().optional(),
        item_type: z.string().optional(),
      }),
    )
    .optional(),
});

export const DisputeMessageSchema = z.looseObject({
  posted_by: z.string().optional(),
  time_posted: z.string().optional(),
  content: z.string().optional(),
});

export const DisputeSchema = z.looseObject({
  dispute_id: z.string(),
  create_time: z.string(),
  update_time: z.string(),
  disputed_transactions: z.array(DisputeTransactionSchema).optional(),
  reason: z.string(),
  status: z.string(),
  dispute_state: z.string().optional(),
  dispute_amount: PayPalMoneySchema,
  dispute_outcome: z
    .looseObject({
      outcome_code: z.string().optional(),
      outcome_reason: z.string().optional(),
      amount_refunded: PayPalMoneySchema.optional(),
    })
    .optional(),
  dispute_life_cycle_stage: z.string(),
  dispute_channel: z.string().optional(),
  messages: z.array(DisputeMessageSchema).optional(),
  evidences: z.array(z.looseObject({ evidence_type: z.string().optional() })).optional(),
  buyer_response_due_date: z.string().optional(),
  seller_response_due_date: z.string().optional(),
  offer: z.looseObject({}).optional(),
  allowed_response_options: z.looseObject({}).optional(),
  links: z.array(LinkSchema).optional(),
});
export type Dispute = z.infer<typeof DisputeSchema>;

export const DisputeSummarySchema = z.looseObject({
  dispute_id: z.string(),
  create_time: z.string().optional(),
  update_time: z.string().optional(),
  reason: z.string().optional(),
  status: z.string().optional(),
  dispute_state: z.string().optional(),
  dispute_amount: PayPalMoneySchema.optional(),
  dispute_life_cycle_stage: z.string().optional(),
  seller_response_due_date: z.string().optional(),
  links: z.array(LinkSchema).optional(),
});
export type DisputeSummary = z.infer<typeof DisputeSummarySchema>;

export const DisputeListSchema = z.looseObject({
  items: z.array(DisputeSummarySchema).optional().default([]),
  links: z.array(LinkSchema).optional(),
});
