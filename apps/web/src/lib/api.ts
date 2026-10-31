import type { z } from "zod";

/** Error carrying the api's own message ("decision is APPROVED", "offer exceeds…"). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function parse(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === "object" && body && "error" in body
        ? String(body.error)
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return body;
}

export async function apiGet<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>> {
  const response = await fetch(`/api/rebuttal/${path}`, { cache: "no-store" });
  return schema.parse(await parse(response));
}

export async function apiSend<T = unknown>(
  method: "POST" | "PUT" | "PATCH",
  path: string,
  body: object = {},
): Promise<T> {
  const response = await fetch(`/api/rebuttal/${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await parse(response)) as T;
}
