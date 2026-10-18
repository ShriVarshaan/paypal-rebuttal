export const SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  webhookId: string | undefined;
}

const LIVE_HOSTS = new Set(["api-m.paypal.com", "api.paypal.com"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Sandbox only (CLAUDE.md). Local hosts are allowed for mock servers in tests. */
export function assertSandboxUrl(baseUrl: string): void {
  const url = new URL(baseUrl);
  if (LIVE_HOSTS.has(url.hostname)) {
    throw new Error(`Refusing live PayPal endpoint ${url.hostname}; Rebuttal is sandbox-only`);
  }
  const ok = url.hostname === new URL(SANDBOX_BASE_URL).hostname || LOCAL_HOSTS.has(url.hostname);
  if (!ok) throw new Error(`PAYPAL_BASE_URL must be ${SANDBOX_BASE_URL} (got ${baseUrl})`);
}

export function payPalConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PayPalConfig {
  const clientId = env["PAYPAL_CLIENT_ID"];
  const clientSecret = env["PAYPAL_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set (or run with SIMULATOR=1)");
  }
  const baseUrl = (env["PAYPAL_BASE_URL"] || SANDBOX_BASE_URL).replace(/\/+$/, "");
  assertSandboxUrl(baseUrl);
  return { clientId, clientSecret, baseUrl, webhookId: env["PAYPAL_WEBHOOK_ID"] || undefined };
}
