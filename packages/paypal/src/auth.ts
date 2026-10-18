import { z } from "zod";
import { PayPalError } from "./errors.js";
import type { Logger } from "./logger.js";

const TokenResponse = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
});

/** Refresh this long before PayPal's `expires_in` runs out. */
export const REFRESH_SKEW_MS = 60_000;

export interface TokenProviderOptions {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  fetch?: typeof fetch;
  now?: () => number;
  log: Logger;
}

/**
 * OAuth2 client-credentials token cache. Concurrent callers share one in-flight
 * request, so ten calls at once produce a single token fetch.
 */
export class TokenProvider {
  private cached: { token: string; expiresAt: number } | undefined;
  private inflight: Promise<string> | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly opts: TokenProviderOptions) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.now = opts.now ?? Date.now;
  }

  async getToken(): Promise<string> {
    if (this.cached && this.now() < this.cached.expiresAt - REFRESH_SKEW_MS) return this.cached.token;
    this.inflight ??= this.fetchToken().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  /** Drop the cached token, e.g. after PayPal answers 401. */
  invalidate(): void {
    this.cached = undefined;
  }

  private async fetchToken(): Promise<string> {
    const path = "/v1/oauth2/token";
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString("base64");
    const started = this.now();
    let res: Response;
    try {
      res = await this.fetchImpl(this.opts.baseUrl + path, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: "grant_type=client_credentials",
      });
    } catch (cause) {
      throw new PayPalError({
        status: 0,
        message: "Network error fetching token",
        method: "POST",
        path,
        cause,
      });
    }
    const debugId = res.headers.get("paypal-debug-id") ?? undefined;
    this.opts.log.info(
      { method: "POST", path, status: res.status, durationMs: this.now() - started, debugId },
      "paypal token",
    );
    const body: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const b = body as { error?: string; error_description?: string };
      throw new PayPalError({
        status: res.status,
        name: b.error ?? "AUTHENTICATION_FAILURE",
        message: b.error_description ?? `Token request failed with ${res.status}`,
        ...(debugId ? { debugId } : {}),
        method: "POST",
        path,
      });
    }
    const parsed = TokenResponse.parse(body);
    this.cached = { token: parsed.access_token, expiresAt: this.now() + parsed.expires_in * 1000 };
    return parsed.access_token;
  }
}
