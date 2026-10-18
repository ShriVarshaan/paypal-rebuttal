/**
 * Replaces personal data in a recorded PayPal payload so it can be committed to fixtures/.
 * Emails become fake addresses, names become "Test Buyer N", and street lines are blanked.
 * The same input value always maps to the same replacement within one call.
 */
export function scrubPayload<T>(payload: T): T {
  const emails = new Map<string, string>();
  const names = new Map<string, string>();

  const fakeEmail = (v: string) => {
    if (!emails.has(v)) emails.set(v, `buyer${emails.size + 1}@example.com`);
    return emails.get(v)!;
  };
  const fakeName = (v: string) => {
    if (!names.has(v)) names.set(v, `Test Buyer ${names.size + 1}`);
    return names.get(v)!;
  };

  const NAME_KEYS = new Set(["name", "full_name", "given_name", "surname", "buyer_name"]);
  const ADDRESS_KEYS = new Set(["address_line_1", "address_line_2", "address_line_3"]);
  const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

  const walk = (value: unknown, key: string | undefined, parentKey: string | undefined): unknown => {
    if (Array.isArray(value)) return value.map((v) => walk(v, undefined, key));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k, key)]));
    }
    if (typeof value !== "string") return value;
    if (key && ADDRESS_KEYS.has(key)) return "1 Test Street";
    // Item names and seller names stay; buyer/payer/shipping names are personal.
    const personalParent = parentKey && ["buyer", "payer", "name", "shipping"].includes(parentKey);
    if (key && NAME_KEYS.has(key) && (personalParent || key !== "name")) return fakeName(value);
    return value.replace(EMAIL, (m) => fakeEmail(m));
  };

  return walk(payload, undefined, undefined) as T;
}
