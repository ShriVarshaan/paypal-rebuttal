import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createEmptyTestDatabase, createTestDatabase, withClient } from "@rebuttal/testkit";
import { afterEach, describe, expect, inject, it } from "vitest";
import { createDb } from "./index.js";

const migrations = join(import.meta.dirname, "../prisma/migrations");
const migration = (name: string) => readFile(join(migrations, name, "migration.sql"), "utf8");

const drops: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(drops.splice(0).map((drop) => drop()));
});

describe("product foundation migrations", () => {
  it("builds a fresh schema with the default merchant and original write guard", async () => {
    const testDb = await createTestDatabase(inject("pgAdminUrl"));
    drops.push(testDb.drop);
    const db = createDb(testDb.url);

    try {
      await expect(db.merchant.findUnique({ where: { id: "default" } })).resolves.toMatchObject({
        name: "Fern & Field Goods",
        defaultCurrency: "USD",
      });

      const created = await db.case.create({
        data: {
          paypalDisputeId: "DEMO-MIGRATION-CASE",
          reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
          status: "WAITING_FOR_SELLER_RESPONSE",
          stage: "CHARGEBACK",
          amountCents: 12900,
          currency: "USD",
          disputedTransactions: [],
          messages: [],
          raw: {},
          paypalCreatedAt: new Date("2026-10-19T00:00:00.000Z"),
          paypalUpdatedAt: new Date("2026-10-19T00:00:00.000Z"),
        },
      });
      expect(created.merchantId).toBe("default");

      const metadata = await withClient(testDb.url, async (client) => {
        const tables = await client.query<{ table_schema: string; table_name: string }>(
          `SELECT table_schema, table_name
             FROM information_schema.tables
            WHERE (table_schema = 'public' AND table_name IN ('Merchant', 'Message', 'EvalRun'))
               OR table_schema = 'store'
            ORDER BY table_schema, table_name`,
        );
        const indexes = await client.query<{ indexname: string; indexdef: string }>(
          `SELECT indexname, indexdef FROM pg_indexes
            WHERE schemaname = 'public'
              AND indexname IN ('Case_state_idx', 'Case_merchantId_state_idx', 'Action_one_success_per_case_kind')`,
        );
        return { tables: tables.rows, indexes: indexes.rows };
      });

      expect(metadata.tables.filter((row) => row.table_schema === "store")).toHaveLength(11);
      expect(metadata.tables.filter((row) => row.table_schema === "public")).toHaveLength(3);
      expect(metadata.indexes.map((row) => row.indexname).sort()).toEqual([
        "Action_one_success_per_case_kind",
        "Case_merchantId_state_idx",
        "Case_state_idx",
      ]);
      expect(
        metadata.indexes.find((row) => row.indexname === "Action_one_success_per_case_kind")?.indexdef,
      ).toContain("WHERE");
    } finally {
      await db.$disconnect();
    }
  });

  it("upgrades populated application tables without replacing rows or indexes", async () => {
    const testDb = await createEmptyTestDatabase(inject("pgAdminUrl"));
    drops.push(testDb.drop);

    const [initial, analysis, foundation] = await Promise.all([
      migration("20261019000000_init"),
      migration("20261020000000_decision_analysis_policy"),
      migration("20261020010000_product_foundation"),
    ]);

    await withClient(testDb.url, async (client) => {
      await client.query(initial);
      await client.query(analysis);
      await client.query(
        `INSERT INTO "Case" (
           "id", "paypalDisputeId", "reason", "status", "stage", "amountCents", "currency",
           "disputedTransactions", "messages", "raw", "paypalCreatedAt", "paypalUpdatedAt",
           "createdAt", "updatedAt"
         ) VALUES (
           'upgrade-case', 'PP-D-UPGRADE', 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
           'WAITING_FOR_SELLER_RESPONSE', 'CHARGEBACK', 4200, 'USD', '[]'::jsonb, '[]'::jsonb,
           '{}'::jsonb, '2026-10-18T00:00:00Z', '2026-10-18T00:00:00Z',
           '2026-10-18T00:00:00Z', '2026-10-18T00:00:00Z'
         )`,
      );
      await client.query(
        `INSERT INTO "Policy" ("id", "config", "updatedAt")
         VALUES ('default', '{"autonomy":{"enabled":false}}'::jsonb, '2026-10-18T00:00:00Z')`,
      );

      const before = await client.query<{ oid: number }>(`SELECT '"Case"'::regclass::oid AS oid`);
      await client.query(foundation);
      const after = await client.query<{
        oid: number;
        paypalDisputeId: string;
        merchantId: string;
      }>(
        `SELECT '"Case"'::regclass::oid AS oid, "paypalDisputeId", "merchantId"
           FROM "Case" WHERE "id" = 'upgrade-case'`,
      );
      const policy = await client.query<{ merchantId: string; config: object }>(
        `SELECT "merchantId", "config" FROM "Policy" WHERE "id" = 'default'`,
      );
      const stateIndex = await client.query(
        `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'Case_state_idx'`,
      );

      expect(after.rows[0]).toMatchObject({
        oid: before.rows[0]?.oid,
        paypalDisputeId: "PP-D-UPGRADE",
        merchantId: "default",
      });
      expect(policy.rows[0]).toMatchObject({
        merchantId: "default",
        config: { autonomy: { enabled: false } },
      });
      expect(stateIndex.rowCount).toBe(1);
    });
  });
});
