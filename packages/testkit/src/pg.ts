import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const MIGRATIONS_DIR = join(import.meta.dirname, "../../db/prisma/migrations");

export interface RunningPostgres {
  /** Connection string for the `postgres` database; use it to create per-test databases. */
  adminUrl: string;
  stop(): Promise<void>;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => (typeof addr === "object" && addr ? resolve(addr.port) : reject(new Error("no port"))));
    });
  });
}

/** Real Postgres binaries from npm, no Docker needed. */
export async function startEmbeddedPostgres(opts: {
  port: number;
  databaseDir: string;
  persistent?: boolean;
  user?: string;
  password?: string;
}): Promise<RunningPostgres> {
  const user = opts.user ?? "rebuttal";
  const password = opts.password ?? "rebuttal";
  const server = new EmbeddedPostgres({
    databaseDir: opts.databaseDir,
    user,
    password,
    port: opts.port,
    persistent: opts.persistent ?? false,
    // UTF-8 like production Postgres; on Windows initdb otherwise picks WIN1252.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
  });
  await server.initialise();
  await server.start();
  return {
    adminUrl: `postgresql://${user}:${password}@127.0.0.1:${opts.port}/postgres`,
    stop: () => server.stop(),
  };
}

/** The Prisma migration files, oldest first. */
export function migrationSql(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8"));
}

export async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Creates a fresh empty database. Callers own applying any desired migration subset. */
export async function createEmptyTestDatabase(
  adminUrl: string,
): Promise<{ url: string; drop(): Promise<void> }> {
  const name = `t_${randomBytes(6).toString("hex")}`;
  await withClient(adminUrl, (c) =>
    c.query(`CREATE DATABASE ${name} ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`),
  );
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: () =>
      withClient(adminUrl, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)).then(() => {}),
  };
}

/** Creates a fresh database with every migration applied. */
export async function createTestDatabase(adminUrl: string): Promise<{ url: string; drop(): Promise<void> }> {
  const database = await createEmptyTestDatabase(adminUrl);
  const url = database.url;
  await withClient(url.toString(), async (c) => {
    for (const sql of migrationSql()) await c.query(sql);
  });
  return database;
}
