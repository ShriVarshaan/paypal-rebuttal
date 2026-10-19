import { createDb } from "@rebuttal/db";
import { seedDemoData } from "@rebuttal/db/seed";

function assertLocalDemoDatabase(connectionString: string): void {
  if (process.env["NODE_ENV"] === "production") throw new Error("db:seed is disabled in production");
  const url = new URL(connectionString);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (!localHosts.has(url.hostname))
    throw new Error(`db:seed only accepts a loopback database host, received ${url.hostname}`);
}

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) throw new Error("DATABASE_URL is not set");
assertLocalDemoDatabase(connectionString);

const db = createDb(connectionString);
try {
  const result = await seedDemoData(db);
  console.log(
    `Demo seed complete: ${result.casesAdded} cases, ${result.evidenceAdded} evidence items, ` +
      `${result.decisionsAdded} decisions, ${result.storeProductsAdded} store products, ` +
      `${result.storeOrdersAdded} store orders added; policy ${result.policyCreated ? "created" : "preserved"}.`,
  );
} finally {
  await db.$disconnect();
}
