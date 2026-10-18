import { describe, expect, it } from "vitest";
import { fromPayPalMoney, toPayPalMoney } from "./money.js";

describe("money", () => {
  it("parses PayPal decimal strings into integer cents", () => {
    expect(fromPayPalMoney({ currency_code: "USD", value: "49.99" })).toEqual({
      cents: 4999,
      currency: "USD",
    });
    expect(fromPayPalMoney({ currency_code: "USD", value: "5" })).toEqual({ cents: 500, currency: "USD" });
    expect(fromPayPalMoney({ currency_code: "USD", value: "0.5" })).toEqual({ cents: 50, currency: "USD" });
    expect(fromPayPalMoney({ currency_code: "JPY", value: "1200" })).toEqual({
      cents: 1200,
      currency: "JPY",
    });
  });

  it("rejects malformed or over-precise values", () => {
    expect(() => fromPayPalMoney({ currency_code: "USD", value: "4.999" })).toThrow();
    expect(() => fromPayPalMoney({ currency_code: "USD", value: "abc" })).toThrow();
    expect(() => fromPayPalMoney({ currency_code: "JPY", value: "1.5" })).toThrow();
  });

  it("formats cents back to PayPal strings", () => {
    expect(toPayPalMoney({ cents: 4999, currency: "USD" })).toEqual({ currency_code: "USD", value: "49.99" });
    expect(toPayPalMoney({ cents: 5, currency: "USD" })).toEqual({ currency_code: "USD", value: "0.05" });
    expect(toPayPalMoney({ cents: 1200, currency: "JPY" })).toEqual({ currency_code: "JPY", value: "1200" });
  });
});
