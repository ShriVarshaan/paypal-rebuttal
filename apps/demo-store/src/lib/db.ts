import "server-only";
import { createDb, type Db } from "@rebuttal/db";

const globalDb = globalThis as typeof globalThis & { rebuttalDemoStoreDb?: Db };

export function getDb(): Db {
  const db = globalDb.rebuttalDemoStoreDb ?? createDb();
  if (process.env["NODE_ENV"] !== "production") globalDb.rebuttalDemoStoreDb = db;
  return db;
}
