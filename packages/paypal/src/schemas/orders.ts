import { z } from "zod";
import { LinkSchema, PayPalMoneySchema } from "./common.js";

// GET /v2/payments/captures/{id} (openapi/payments_payment_v2.json)
export const CaptureSchema = z.looseObject({
  id: z.string(),
  status: z.string(),
  amount: PayPalMoneySchema.optional(),
  invoice_id: z.string().optional(),
  create_time: z.string().optional(),
  update_time: z.string().optional(),
  supplementary_data: z
    .looseObject({
      related_ids: z.looseObject({ order_id: z.string().optional() }).optional(),
    })
    .optional(),
  links: z.array(LinkSchema).optional(),
});
export type Capture = z.infer<typeof CaptureSchema>;

const AddressSchema = z.looseObject({
  address_line_1: z.string().optional(),
  address_line_2: z.string().optional(),
  admin_area_2: z.string().optional(),
  admin_area_1: z.string().optional(),
  postal_code: z.string().optional(),
  country_code: z.string().optional(),
});

// GET /v2/checkout/orders/{id} (openapi/checkout_orders_v2.json)
export const OrderSchema = z.looseObject({
  id: z.string(),
  status: z.string(),
  create_time: z.string().optional(),
  purchase_units: z
    .array(
      z.looseObject({
        reference_id: z.string().optional(),
        items: z
          .array(
            z.looseObject({
              name: z.string(),
              quantity: z.string(),
              sku: z.string().optional(),
              unit_amount: PayPalMoneySchema.optional(),
            }),
          )
          .optional(),
        shipping: z
          .looseObject({
            name: z.looseObject({ full_name: z.string().optional() }).optional(),
            address: AddressSchema.optional(),
            trackers: z.array(z.looseObject({ id: z.string(), status: z.string().optional() })).optional(),
          })
          .optional(),
        payments: z
          .looseObject({
            captures: z.array(z.looseObject({ id: z.string(), status: z.string().optional() })).optional(),
          })
          .optional(),
      }),
    )
    .optional()
    .default([]),
  payer: z.looseObject({ email_address: z.string().optional(), payer_id: z.string().optional() }).optional(),
  links: z.array(LinkSchema).optional(),
});
export type Order = z.infer<typeof OrderSchema>;

export const RefundSchema = z.looseObject({
  id: z.string(),
  status: z.string(),
  amount: PayPalMoneySchema.optional(),
  links: z.array(LinkSchema).optional(),
});
export type Refund = z.infer<typeof RefundSchema>;
