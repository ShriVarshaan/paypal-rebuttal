import { llmFromEnv } from "@rebuttal/agent";
import { createDb } from "@rebuttal/db";
import { assertSafeForProduction, createPayPalClient } from "@rebuttal/paypal";
import { QUEUES, ensureQueues, pgBossQueue } from "@rebuttal/worker";
import { PgBoss } from "pg-boss";
import { buildApp } from "./app.js";
import { apiConfigFromEnv } from "./config.js";

async function main() {
  assertSafeForProduction();
  const config = apiConfigFromEnv();
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");

  const db = createDb(databaseUrl);
  // The api only sends jobs; the worker runs maintenance and cron.
  const boss = new PgBoss({
    connectionString: databaseUrl,
    application_name: "rebuttal-api",
    supervise: false,
    schedule: false,
  });
  await boss.start();
  await ensureQueues(boss);

  const paypal = createPayPalClient();
  const app = await buildApp({
    db,
    paypal,
    queue: pgBossQueue(boss),
    config,
    llm: llmFromEnv(),
    checkQueue: async () => {
      if (!(await boss.getQueue(QUEUES.disputeSync))) throw new Error("queues not installed");
    },
  });

  const close = async () => {
    await app.close();
    await boss.stop({ graceful: true, timeout: 10_000 });
    await db.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void close());
  process.on("SIGINT", () => void close());

  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    { mode: paypal.mode, skipWebhookVerify: config.skipWebhookVerify || paypal.mode === "simulator" },
    "api ready",
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
