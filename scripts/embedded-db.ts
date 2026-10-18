// Postgres without Docker: real Postgres 17 binaries from npm, data in .pgdata/.
//   pnpm db:embedded          # leave running, then in another terminal: pnpm db:migrate
// Same credentials and port as docker-compose.yml, so DATABASE_URL in .env works unchanged.
import { existsSync } from "node:fs";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { findRepoRoot } from "@rebuttal/paypal";

const dir = join(findRepoRoot(), ".pgdata");
const fresh = !existsSync(dir);
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "rebuttal",
  password: "rebuttal",
  port: Number(process.env.PGPORT ?? 5432),
  persistent: true,
  // UTF-8 like production; on Windows initdb otherwise picks WIN1252 (only applies to a fresh .pgdata).
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase("rebuttal");
console.log(
  `Postgres ready on postgresql://rebuttal:rebuttal@localhost:${process.env.PGPORT ?? 5432}/rebuttal (Ctrl+C to stop)`,
);
if (fresh) console.log("First run: now run `pnpm db:migrate` in another terminal.");

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
setInterval(() => {}, 1 << 30);
