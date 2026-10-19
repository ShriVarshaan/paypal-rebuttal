import { timingSafeEqual } from "node:crypto";

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Private store APIs are open only when no local token is configured. */
export function storeApiAuthorized(request: Request): boolean {
  const configured = process.env["STORE_API_TOKEN"];
  if (!configured) return process.env["NODE_ENV"] !== "production";
  const authorization = request.headers.get("authorization");
  return !!authorization && equal(authorization, `Bearer ${configured}`);
}
