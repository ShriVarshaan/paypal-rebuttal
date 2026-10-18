import { describe, expect, it } from "vitest";
import { scrubPayload } from "./scrub.js";
import { assertSandboxUrl } from "./config.js";

describe("scrubPayload", () => {
  it("replaces buyer names, emails and street lines but keeps item names", () => {
    const out = scrubPayload({
      disputed_transactions: [
        {
          buyer: { name: "Jane Real" },
          seller: { email: "shop@real-store.com", name: "Real Store" },
          items: [{ name: "Headphones" }],
        },
      ],
      messages: [{ content: "Email me at jane.real@gmail.com please" }],
      purchase_units: [
        {
          shipping: {
            name: { full_name: "Jane Real" },
            address: { address_line_1: "42 Real Rd", postal_code: "95131" },
          },
        },
      ],
      payer: { email_address: "jane.real@gmail.com" },
    });
    expect(out.disputed_transactions[0]!.buyer.name).toBe("Test Buyer 1");
    expect(out.disputed_transactions[0]!.seller.email).toBe("buyer1@example.com");
    expect(out.disputed_transactions[0]!.items[0]!.name).toBe("Headphones");
    expect(out.messages[0]!.content).toBe("Email me at buyer2@example.com please");
    expect(out.purchase_units[0]!.shipping.name.full_name).toBe("Test Buyer 1");
    expect(out.purchase_units[0]!.shipping.address).toEqual({
      address_line_1: "1 Test Street",
      postal_code: "95131",
    });
    expect(out.payer.email_address).toBe("buyer2@example.com");
  });
});

describe("assertSandboxUrl", () => {
  it("refuses live endpoints", () => {
    expect(() => assertSandboxUrl("https://api-m.paypal.com")).toThrow(/sandbox-only/);
    expect(() => assertSandboxUrl("https://evil.example.com")).toThrow();
    expect(() => assertSandboxUrl("https://api-m.sandbox.paypal.com")).not.toThrow();
  });
});
