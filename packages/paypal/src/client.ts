import { TokenProvider } from "./auth.js";
import { payPalConfigFromEnv, type PayPalConfig } from "./config.js";
import { createDisputesApi, type DisputesApi } from "./disputes.js";
import { HttpClient } from "./http.js";
import { defaultLogger, type Logger } from "./logger.js";
import { createOrdersApi, createPaymentsApi, type OrdersApi, type PaymentsApi } from "./orders.js";
import { createSimulatorClient, type SimulatorOptions } from "./simulator.js";
import { toolkitReader } from "./toolkit.js";
import { createWebhooksApi, type WebhooksApi } from "./webhooks.js";

export interface PayPalClient {
  readonly mode: "sandbox" | "simulator";
  disputes: DisputesApi;
  orders: OrdersApi;
  payments: PaymentsApi;
  webhooks: WebhooksApi;
  /** Health check: obtains (or reuses) an OAuth token. */
  ping(): Promise<void>;
}

export interface CreatePayPalClientOptions {
  env?: NodeJS.ProcessEnv;
  config?: PayPalConfig;
  log?: Logger;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Where list/show go. Default from PAYPAL_DISPUTES_VIA, else "toolkit". */
  disputesVia?: "toolkit" | "rest";
  /** Force simulator mode on or off. Default: SIMULATOR=1. */
  simulator?: boolean | SimulatorOptions;
}

export function isSimulator(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SIMULATOR"] === "1" || env["SIMULATOR"] === "true";
}

/** Throws when simulator mode or webhook-verify bypass is configured in production. */
export function assertSafeForProduction(env: NodeJS.ProcessEnv = process.env): void {
  if (env["NODE_ENV"] !== "production") return;
  if (isSimulator(env)) throw new Error("SIMULATOR=1 is not allowed when NODE_ENV=production");
  if (env["WEBHOOK_SKIP_VERIFY"] === "1")
    throw new Error("WEBHOOK_SKIP_VERIFY=1 is not allowed when NODE_ENV=production");
}

export function createPayPalClient(opts: CreatePayPalClientOptions = {}): PayPalClient {
  const env = opts.env ?? process.env;
  assertSafeForProduction(env);

  const simulator = opts.simulator ?? isSimulator(env);
  if (simulator) return createSimulatorClient(typeof simulator === "object" ? simulator : {});

  const config = opts.config ?? payPalConfigFromEnv(env);
  const log = opts.log ?? defaultLogger();
  const tokens = new TokenProvider({ ...config, log, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  const http = new HttpClient({
    baseUrl: config.baseUrl,
    tokens,
    log,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
  });
  const via = opts.disputesVia ?? (env["PAYPAL_DISPUTES_VIA"] === "rest" ? "rest" : "toolkit");

  return {
    mode: "sandbox",
    disputes: createDisputesApi(http, log, via === "toolkit" ? toolkitReader(config) : undefined),
    orders: createOrdersApi(http),
    payments: createPaymentsApi(http),
    webhooks: createWebhooksApi(http),
    async ping() {
      await tokens.getToken();
    },
  };
}
