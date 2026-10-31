// pnpm evidence:preview <caseId> [--open]: build the pack for a case's newest decision into
// tmp/evidence-preview/<caseId>/ without touching EvidencePack rows or the job queue.
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { createDb } from "@rebuttal/db";
import { launchPdfEngine } from "./engine.js";
import { loadPackInput } from "./loader.js";
import { buildEvidencePack } from "./pack.js";

const print = (line: string) =>
  process.stdout.write(`${line}
`);
const root = resolve(import.meta.dirname, "../../..");
const caseId = process.argv[2];
if (!caseId || caseId.startsWith("--")) {
  console.error("usage: pnpm evidence:preview <caseId|paypalDisputeId> [--open]");
  process.exit(2);
}
const url = process.env["DATABASE_URL"];
if (!url) throw new Error("DATABASE_URL is not set");
const db = createDb(url);
const row = await db.case.findFirst({ where: { OR: [{ id: caseId }, { paypalDisputeId: caseId }] } });
if (!row) {
  console.error(`No case ${caseId}`);
  process.exit(1);
}
const engine = await launchPdfEngine();
try {
  const input = await loadPackInput(db, { caseId: row.id }, { storageDir: join(root, "storage/evidence") });
  const result = await buildEvidencePack(input, {
    engine,
    outDir: join(root, "tmp/evidence-preview", row.id),
  });
  for (const f of result.files)
    print(`${f.evidenceType.padEnd(36)} ${f.name}  ${(f.sizeBytes / 1024).toFixed(0)} KB`);
  print(`preview: ${result.preview.path} (${result.preview.pages} pages, profile ${result.profile})`);
  for (const w of result.warnings) print(`warning: ${w}`);
  if (process.argv.includes("--open")) {
    const opener =
      process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
    spawn(opener, [result.preview.path], { detached: true, stdio: "ignore" }).unref();
  }
} finally {
  await engine.close();
  await db.$disconnect();
}
