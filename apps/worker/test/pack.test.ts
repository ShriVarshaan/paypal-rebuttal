import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOfflineEasyPostSource } from "@rebuttal/connectors";
import type { PdfEngine } from "@rebuttal/evidence";
import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it } from "vitest";
import { enrichCase } from "../src/jobs/enrich.js";
import { executeDecision } from "../src/jobs/execute.js";
import { gatherEvidence } from "../src/jobs/gather.js";
import { buildPack } from "../src/jobs/pack.js";
import { syncDispute } from "../src/jobs/sync.js";
import { triageCase } from "../src/jobs/triage.js";
import { QUEUES } from "../src/queues.js";
import { clock, setupTestEnv, type TestEnv } from "./helpers.js";

const fresh = setupTestEnv([createOfflineEasyPostSource(() => clock.now)]);
let t: TestEnv;

/** One blank page per rendered section: enough for the merge, split and size checks. */
const engine = (): PdfEngine => ({
  async pdf() {
    const doc = await PDFDocument.create();
    doc.addPage();
    return doc.save();
  },
  async jpeg(image) {
    return image;
  },
  async close() {},
});

beforeEach(async () => {
  t = await fresh();
  t.deps.pdfEngine = async () => engine();
  t.deps.evidenceStorageDir = mkdtempSync(join(tmpdir(), "rebuttal-packs-"));
});

async function fightDecision(): Promise<{ caseId: string; decisionId: string }> {
  const { caseId } = await syncDispute(t.deps, "PP-D-90001");
  await enrichCase(t.deps, caseId);
  await gatherEvidence(t.deps, caseId);
  const r = await triageCase(t.deps, caseId);
  if (r.status !== "decided" || r.option !== "FIGHT")
    throw new Error(`expected FIGHT, got ${JSON.stringify(r)}`);
  return { caseId, decisionId: r.decisionId };
}

describe("pack.build", () => {
  it("is queued by triage for FIGHT decisions so the PDF exists before approval", async () => {
    const { decisionId } = await fightDecision();
    expect(t.queue.take(QUEUES.packBuild).map((s) => [s.data, s.options.singletonKey])).toEqual([
      [{ decisionId }, decisionId],
    ]);
  });

  it("stores a READY pack, records PACK_READY and sends pack.ready", async () => {
    const { caseId, decisionId } = await fightDecision();
    t.queue.sent.length = 0;
    const r = await buildPack(t.deps, decisionId);
    expect(r.status).toBe("ready");
    const pack = await t.db.evidencePack.findFirstOrThrow({ where: { decisionId } });
    expect(pack.status).toBe("READY");
    expect(pack.previewPath).toMatch(/evidence-pack-pp-d-90001\.pdf$/);
    const files = pack.files as { evidenceType: string; exhibits: string[]; path: string }[];
    expect(files.map((f) => f.evidenceType)).toEqual(["PROOF_OF_FULFILLMENT"]);
    expect(files[0]!.path.startsWith(join(t.deps.evidenceStorageDir, caseId, "packs", pack.id))).toBe(true);
    expect(pack.totalBytes).toBeGreaterThan(0);
    const events = await t.db.caseEvent.findMany({ where: { caseId, type: "PACK_READY" } });
    expect(events).toHaveLength(1);
    expect(t.queue.take(QUEUES.packReady).map((s) => s.data)).toEqual([{ packId: pack.id }]);
  });

  it("supersedes the previous pack when rebuilt", async () => {
    const { decisionId } = await fightDecision();
    await buildPack(t.deps, decisionId);
    await buildPack(t.deps, decisionId);
    const packs = await t.db.evidencePack.findMany({ where: { decisionId }, orderBy: { createdAt: "asc" } });
    expect(packs.map((p) => p.status)).toEqual(["SUPERSEDED", "READY"]);
  });

  it("never revives a pack that was superseded while it rendered", async () => {
    const { caseId, decisionId } = await fightDecision();
    t.queue.sent.length = 0;
    const base = engine();
    let retired = false;
    // A rejection or narrative edit lands mid-render and retires the PENDING pack.
    t.deps.pdfEngine = async () => ({
      ...base,
      async pdf(html) {
        if (!retired) {
          retired = true;
          await t.db.evidencePack.updateMany({ where: { decisionId }, data: { status: "SUPERSEDED" } });
        }
        return base.pdf(html);
      },
    });
    expect(await buildPack(t.deps, decisionId)).toEqual({
      status: "skipped",
      reason: "superseded while rendering",
    });
    const pack = await t.db.evidencePack.findFirstOrThrow({ where: { decisionId } });
    expect(pack.status).toBe("SUPERSEDED");
    expect(await t.db.caseEvent.count({ where: { caseId, type: "PACK_READY" } })).toBe(0);
    expect(t.queue.take(QUEUES.packReady)).toEqual([]);
  });

  it("records a failure the seller can see instead of retrying forever", async () => {
    const { caseId, decisionId } = await fightDecision();
    t.deps.pdfEngine = async () => {
      throw new Error("Executable doesn't exist: run pnpm browser:install");
    };
    const r = await buildPack(t.deps, decisionId);
    expect(r).toMatchObject({ status: "failed" });
    const pack = await t.db.evidencePack.findFirstOrThrow({ where: { decisionId } });
    expect(pack).toMatchObject({ status: "FAILED", error: expect.stringContaining("browser:install") });
    expect(await t.db.notification.count({ where: { caseId, kind: "PACK_FAILED" } })).toBe(1);
  });

  it("skips non-FIGHT decisions and unconfigured workers", async () => {
    const { decisionId } = await fightDecision();
    await t.db.decision.update({ where: { id: decisionId }, data: { option: "ACCEPT" } });
    expect(await buildPack(t.deps, decisionId)).toEqual({ status: "skipped", reason: "decision is ACCEPT" });
    t.deps.pdfEngine = null;
    expect((await buildPack(t.deps, decisionId)).status).toBe("skipped");
  });

  it("is what the executor files once the decision is approved", async () => {
    const { caseId, decisionId } = await fightDecision();
    await buildPack(t.deps, decisionId);
    await t.db.decision.update({
      where: { id: decisionId },
      data: { status: "APPROVED", approvedBy: "seller" },
    });
    const r = await executeDecision(t.deps, decisionId, { retryCount: 0, retryLimit: 3 });
    expect(r.status).toBe("succeeded");
    const action = await t.db.action.findFirstOrThrow({ where: { caseId, kind: "PROVIDE_EVIDENCE" } });
    const request = action.request as { files: { name: string }[]; evidences: { evidence_type: string }[] };
    expect(request.files.map((f) => f.name)).toEqual(["01-proof-of-fulfillment.pdf"]);
    expect(request.evidences.map((e) => e.evidence_type)).toEqual(["PROOF_OF_FULFILLMENT"]);
    expect((await t.db.case.findUniqueOrThrow({ where: { id: caseId } })).state).toBe("FILED");
  });
});
