import { NextResponse } from "next/server";
import { z } from "zod";
import { storeApiAuthorized } from "./auth";

export const json = <T extends z.ZodType>(schema: T, value: unknown) =>
  NextResponse.json(schema.parse(value));

export function authorize(request: Request): NextResponse | null {
  return storeApiAuthorized(request) ? null : NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export const notFound = (resource: string) =>
  NextResponse.json({ error: `${resource} not found` }, { status: 404 });

export const invalidQuery = (issues: z.core.$ZodIssue[]) =>
  NextResponse.json({ error: "invalid query", issues }, { status: 400 });
