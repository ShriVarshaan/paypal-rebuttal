import { z } from "zod";

export const PayPalMoneySchema = z.object({ currency_code: z.string(), value: z.string() });

export const LinkSchema = z.looseObject({
  href: z.string(),
  rel: z.string(),
  method: z.string().optional(),
});

/** Most write endpoints answer with just HATEOAS links. */
export const LinksResponseSchema = z.looseObject({
  links: z.array(LinkSchema).optional(),
});
export type LinksResponse = z.infer<typeof LinksResponseSchema>;
