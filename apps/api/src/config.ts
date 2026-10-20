import { resolve } from "node:path";

export interface ApiConfig {
  port: number;
  host: string;
  /** CORS is locked to this origin (the web app). */
  webOrigin: string;
  /** Bearer token for the REST routes. Required in production. */
  apiToken: string | undefined;
  webhookId: string | undefined;
  /** Dev/simulator only: accept webhooks without asking PayPal to verify them. */
  skipWebhookVerify: boolean;
  production: boolean;
  /** Absolute root under which browser evidence files may be served. */
  evidenceStorageDir: string;
}

export function apiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const production = env["NODE_ENV"] === "production";
  const skipWebhookVerify = env["WEBHOOK_SKIP_VERIFY"] === "1";
  if (production && skipWebhookVerify)
    throw new Error("WEBHOOK_SKIP_VERIFY=1 is not allowed when NODE_ENV=production");
  const apiToken = env["API_TOKEN"] || undefined;
  if (production && !apiToken) throw new Error("API_TOKEN must be set when NODE_ENV=production");
  if (production && !env["PAYPAL_WEBHOOK_ID"])
    throw new Error("PAYPAL_WEBHOOK_ID must be set when NODE_ENV=production");
  return {
    port: Number(env["PORT"] ?? 3001),
    host: env["HOST"] ?? (production ? "0.0.0.0" : "127.0.0.1"),
    webOrigin: env["WEB_ORIGIN"] ?? "http://localhost:3000",
    apiToken,
    webhookId: env["PAYPAL_WEBHOOK_ID"] || undefined,
    skipWebhookVerify,
    production,
    evidenceStorageDir: resolve(env["EVIDENCE_STORAGE_DIR"] ?? "storage/evidence"),
  };
}
