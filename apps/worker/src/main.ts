import { defaultSources } from "@rebuttal/connectors";
import { createDb } from "@rebuttal/db";
import { assertSafeForProduction, createPayPalClient } from "@rebuttal/paypal";
import { PgBoss } from "pg-boss";
import { pino } from "pino";
import { defaultDeps } from "./deps.js";
import { pgBossQueue } from "./queues.js";
import { startWorker } from "./worker.js";

const log = pino({ name: "worker", level: process.env["LOG_LEVEL"] ?? "info" });

async function main() {
  assertSafeForProduction();
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");

  const db = createDb(databaseUrl);
  const paypal = createPayPalClient({ log });
  const boss = new PgBoss({ connectionString: databaseUrl, application_name: "rebuttal-worker" });
  boss.on("error", (err) => log.error({ err: err.message }, "pg-boss error"));
  await boss.start();

  await startWorker(
    boss,
    defaultDeps({ db, paypal, queue: pgBossQueue(boss), log, sources: defaultSources() }),
    {
      pollCron: process.env["POLL_DISABLED"] === "1" ? false : "* * * * *",
    },
  );
  log.info({ mode: paypal.mode }, "worker started");

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "shutting down");
    await boss.stop({ graceful: true, timeout: 30_000 });
    await db.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  log.fatal({ err: err instanceof Error ? err.message : String(err) }, "worker failed to start");
  process.exit(1);
});
