// Test helper: a scripted `fetch` that records every request.

export interface RecordedRequest {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export type Responder = (req: RecordedRequest) => Response | Promise<Response>;

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export const tokenResponse = (token = "tok-1", expiresIn = 32400) =>
  json(200, { access_token: token, token_type: "Bearer", expires_in: expiresIn });

/**
 * Routes `/v1/oauth2/token` to `token` and everything else to the queued responders in order.
 */
export function fakeFetch(responders: Responder[], token: Responder = () => tokenResponse()) {
  const requests: RecordedRequest[] = [];
  const tokenRequests: RecordedRequest[] = [];
  const queue = [...responders];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const req: RecordedRequest = { url, method: init?.method ?? "GET", headers, body: init?.body };
    if (url.pathname === "/v1/oauth2/token") {
      tokenRequests.push(req);
      return token(req);
    }
    requests.push(req);
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected request ${req.method} ${url.pathname}`);
    return next(req);
  }) as typeof fetch;
  return { fetch: fn, requests, tokenRequests, remaining: () => queue.length };
}

export const noSleep = async () => {};
