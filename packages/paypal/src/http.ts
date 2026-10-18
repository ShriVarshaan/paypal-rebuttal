import type { z } from "zod";
import type { TokenProvider } from "./auth.js";
import { PayPalError, PayPalResponseValidationError, type PayPalErrorDetail } from "./errors.js";
import type { Logger } from "./logger.js";

export const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 250;
const MAX_DELAY_MS = 8_000;
const MAX_RETRY_AFTER_MS = 30_000;

type Query = Record<string, string | number | boolean | undefined | null>;

interface BaseRequest<T> {
  path: string;
  query?: Query;
  /** zod schema for the response body. Omit only for empty responses. */
  schema?: z.ZodType<T>;
  headers?: Record<string, string>;
}

export interface GetRequest<T> extends BaseRequest<T> {
  method: "GET";
}

export interface WriteRequest<T> extends BaseRequest<T> {
  method: "POST" | "PATCH";
  /** Sent as `PayPal-Request-Id`. Must be stable across retries of the same logical call. */
  idempotencyKey: string;
  /** Exactly one of `json`, `rawJson` (pre-serialised) or `form`. */
  json?: unknown;
  rawJson?: string;
  form?: FormData;
}

export type PayPalRequest<T> = GetRequest<T> | WriteRequest<T>;

export interface HttpClientOptions {
  baseUrl: string;
  tokens: TokenProvider;
  log: Logger;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

export class HttpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(private readonly opts: HttpClientOptions) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = opts.random ?? Math.random;
    this.now = opts.now ?? Date.now;
  }

  get baseUrl(): string {
    return this.opts.baseUrl;
  }

  async request<T>(req: PayPalRequest<T>): Promise<T> {
    if (req.method !== "GET" && !req.idempotencyKey) {
      throw new Error(`PayPal-Request-Id is required for ${req.method} ${req.path}`);
    }
    let refreshedToken = false;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.once(req, attempt);
      } catch (err) {
        if (!(err instanceof PayPalError)) throw err;
        // An expired or revoked token: refresh once and retry straight away.
        if (err.status === 401 && !refreshedToken) {
          refreshedToken = true;
          this.opts.tokens.invalidate();
          attempt--;
          continue;
        }
        if (!err.retryable || attempt >= MAX_ATTEMPTS) throw err;
        await this.sleep(
          this.backoff(attempt, (err as PayPalError & { retryAfterMs?: number }).retryAfterMs),
        );
      }
    }
  }

  /** Full-jitter exponential backoff, or the server's `Retry-After` when it sent one. */
  backoff(attempt: number, retryAfterMs?: number): number {
    if (retryAfterMs !== undefined) return Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);
    const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
    return Math.round(ceiling / 2 + (this.random() * ceiling) / 2);
  }

  private async once<T>(req: PayPalRequest<T>, attempt: number): Promise<T> {
    const url = new URL(this.opts.baseUrl + req.path);
    for (const [k, v] of Object.entries(req.query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.opts.tokens.getToken()}`,
      Accept: "application/json",
      ...req.headers,
    };
    let body: string | FormData | undefined;
    if (req.method !== "GET") {
      headers["PayPal-Request-Id"] = req.idempotencyKey;
      if (req.form) {
        body = req.form; // fetch sets the multipart boundary itself
      } else if (req.rawJson !== undefined || req.json !== undefined) {
        headers["Content-Type"] = "application/json";
        body = req.rawJson ?? JSON.stringify(req.json);
      }
    }

    const started = this.now();
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: req.method,
        headers,
        ...(body !== undefined ? { body } : {}),
      });
    } catch (cause) {
      this.opts.log.warn(
        { method: req.method, path: req.path, attempt, durationMs: this.now() - started },
        "paypal network error",
      );
      throw new PayPalError({
        status: 0,
        name: "NETWORK_ERROR",
        message: cause instanceof Error ? cause.message : "Network error",
        method: req.method,
        path: req.path,
        cause,
      });
    }

    const debugId = res.headers.get("paypal-debug-id") ?? undefined;
    // Never log bodies or headers: they carry tokens and buyer PII.
    this.opts.log.info(
      {
        method: req.method,
        path: req.path,
        status: res.status,
        durationMs: this.now() - started,
        debugId,
        attempt,
      },
      "paypal request",
    );

    const text = await res.text();
    const data: unknown = text ? safeJson(text) : undefined;

    if (!res.ok) {
      const b = (data ?? {}) as {
        name?: string;
        message?: string;
        debug_id?: string;
        details?: PayPalErrorDetail[];
      };
      const err = new PayPalError({
        status: res.status,
        name: b.name ?? `HTTP_${res.status}`,
        message: b.message ?? `PayPal ${req.method} ${req.path} failed with ${res.status}`,
        ...((b.debug_id ?? debugId) ? { debugId: b.debug_id ?? debugId } : {}),
        details: Array.isArray(b.details) ? b.details : [],
        method: req.method,
        path: req.path,
      });
      const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"), this.now());
      if (retryAfterMs !== undefined) Object.assign(err, { retryAfterMs });
      throw err;
    }

    if (!req.schema) return data as T;
    const parsed = req.schema.safeParse(data ?? {});
    if (!parsed.success) throw new PayPalResponseValidationError(req.path, parsed.error.issues);
    return parsed.data;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 200) };
  }
}

/** `Retry-After` is either delta-seconds or an HTTP date. */
export function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
