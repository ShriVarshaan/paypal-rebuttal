import { z } from "zod";
import { Money } from "./money.js";

/** Order, capture and shipment facts for a Case, attached by the `case.enrich` job. */
export const TransactionContext = z.object({
  fetchedAt: z.string(),
  capture: z
    .object({
      id: z.string(),
      status: z.string(),
      amount: Money.nullable(),
      createdAt: z.string().nullable(),
    })
    .nullable(),
  order: z
    .object({
      id: z.string(),
      status: z.string(),
      createdAt: z.string().nullable(),
      items: z.array(
        z.object({
          name: z.string(),
          sku: z.string().nullable(),
          quantity: z.string(),
          unitAmount: Money.nullable(),
        }),
      ),
      shipping: z
        .object({
          fullName: z.string().nullable(),
          address: z.record(z.string(), z.string()).nullable(),
        })
        .nullable(),
      trackingNumbers: z.array(z.object({ trackingNumber: z.string(), status: z.string().nullable() })),
    })
    .nullable(),
  errors: z.array(z.string()),
});
export type TransactionContext = z.infer<typeof TransactionContext>;
