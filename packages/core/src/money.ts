import { z } from "zod";

/**
 * Money is an integer number of minor units ("cents") plus an ISO-4217 code.
 * PayPal sends amounts as decimal strings (`"49.99"`); convert at the edge with
 * `fromPayPalMoney` / `toPayPalMoney` and never do arithmetic on the strings.
 */
export const Money = z.object({
  cents: z.number().int(),
  currency: z.string().length(3),
});
export type Money = z.infer<typeof Money>;

export interface PayPalMoney {
  currency_code: string;
  value: string;
}

// PayPal currencies without minor units.
const ZERO_DECIMAL = new Set(["HUF", "JPY", "TWD"]);

export function minorUnitDigits(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

export function fromPayPalMoney(m: PayPalMoney): Money {
  const digits = minorUnitDigits(m.currency_code);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(m.value.trim());
  if (!match) throw new Error(`Invalid PayPal money value: ${m.value}`);
  const [, sign, whole = "0", frac = ""] = match;
  if (frac.length > digits) throw new Error(`Too many decimals for ${m.currency_code}: ${m.value}`);
  const cents = Number(whole) * 10 ** digits + Number(frac.padEnd(digits, "0") || "0");
  return { cents: sign === "-" ? -cents : cents, currency: m.currency_code.toUpperCase() };
}

export function toPayPalMoney(m: Money): PayPalMoney {
  const digits = minorUnitDigits(m.currency);
  const abs = Math.abs(m.cents);
  const whole = Math.floor(abs / 10 ** digits);
  const frac = digits ? "." + String(abs % 10 ** digits).padStart(digits, "0") : "";
  return { currency_code: m.currency, value: `${m.cents < 0 ? "-" : ""}${whole}${frac}` };
}
