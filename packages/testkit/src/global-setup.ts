import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { freePort, startEmbeddedPostgres } from "./pg.js";
import "./provided.js";

/**
 * Vitest globalSetup: one Postgres per test run. Set TEST_DATABASE_URL (pointing at the
 * `postgres` database of a server you run, e.g. docker compose) to skip the embedded one.
 */
export default async function setup(project: TestProject): Promise<(() => Promise<void>) | void> {
  const external = process.env["TEST_DATABASE_URL"];
  if (external) {
    project.provide("pgAdminUrl", external);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "rebuttal-pg-"));
  const pg = await startEmbeddedPostgres({ port: await freePort(), databaseDir: dir });
  project.provide("pgAdminUrl", pg.adminUrl);
  return async () => {
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}
