/* eslint-disable no-console -- command-line tool */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { llmFromEnv } from "@rebuttal/agent";
import { toPayPalMoney } from "@rebuttal/core";
import { cohensKappa, disagreements, fleissKappa, LabelFile } from "./agreement.js";
import { calibrateCv, split } from "./calibrate.js";
import { generateCases } from "./generate.js";
import { toHtml, toMarkdown } from "./report.js";
import {
  buildReport,
  CACHE_PATH,
  caseSummary,
  fileCache,
  GENERATED_PATH,
  loadCases,
  PKG,
  runEval,
} from "./run.js";

const REPO = join(PKG, "../..");
const REPORT_DIR = join(REPO, "docs/eval");
const WEIGHTS_PATH = join(REPO, "packages/decision/src/weights.calibrated.json");
const LABELS_DIR = join(PKG, "labels");

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`wrote ${path.slice(REPO.length + 1)}`);
}

async function main() {
  const [cmd = "run", ...args] = process.argv.slice(2);
  switch (cmd) {
    case "generate": {
      write(GENERATED_PATH, JSON.stringify(generateCases(), null, 2) + "\n");
      break;
    }
    case "calibrate": {
      const { train } = split(loadCases());
      const r = calibrateCv(train);
      console.log(
        `λ = ${r.lambda} by 5-fold CV; train log-loss ${r.trainLoss.before.toFixed(4)} → ${r.trainLoss.after.toFixed(4)} on ${train.length} cases`,
      );
      write(WEIGHTS_PATH, JSON.stringify(r.weights, null, 2) + "\n");
      break;
    }
    case "run": {
      const useLlm = args.includes("--llm");
      const llm = useLlm ? llmFromEnv() : null;
      if (useLlm && !llm)
        console.warn("--llm given but ANTHROPIC_API_KEY is not set; using cached triage only");
      const cache = fileCache(existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, "utf8")) : {});
      const run = await runEval({ llm, cache });
      if (cache.dirty) write(CACHE_PATH, JSON.stringify(cache.dump(), null, 2) + "\n");
      const report = buildReport(run);
      write(
        join(PKG, "results/latest.json"),
        JSON.stringify({ ...run, strategies: run.strategies.map(({ results: _r, ...s }) => s) }, null, 2) +
          "\n",
      );
      write(join(REPORT_DIR, "report.md"), toMarkdown(report));
      write(join(REPORT_DIR, "report.html"), toHtml(report));
      console.log("");
      for (const line of report.headline) console.log(`  ${line}`);
      console.log("");
      for (const s of run.strategies) {
        console.log(
          s.status === "ran"
            ? `  ${s.label.padEnd(32)} acc ${(s.all!.accuracy * 100).toFixed(1).padStart(5)}%  brier ${s.all!.brier?.toFixed(3) ?? "  —  "}  realized $${(s.all!.realizedCents / 100).toFixed(2)}`
            : `  ${s.label.padEnd(32)} skipped: ${s.note}`,
        );
      }
      break;
    }
    case "label-sheet": {
      // A blank sheet for independent labeling: no draft labels, so nobody anchors on them.
      const sheet = loadCases().map((c) => ({
        id: c.id,
        title: c.title,
        reason: c.dispute.reason,
        stage: c.dispute.stage,
        amount: toPayPalMoney({ cents: c.dispute.amountCents, currency: c.dispute.currency }).value,
        buyerSays: c.dispute.messages.map((m) => m.content).join(" / "),
        evidence: caseSummary(c),
      }));
      write(join(LABELS_DIR, "sheet.json"), JSON.stringify(sheet, null, 2) + "\n");
      console.log(
        `Copy labels/TEMPLATE.json to labels/<you>.json and fill in FIGHT, OFFER or ACCEPT for each id.`,
      );
      write(
        join(LABELS_DIR, "TEMPLATE.json"),
        JSON.stringify(
          { labeler: "your-name", labels: Object.fromEntries(sheet.map((s) => [s.id, ""])) },
          null,
          2,
        ) + "\n",
      );
      break;
    }
    case "agreement": {
      const files = existsSync(LABELS_DIR)
        ? readdirSync(LABELS_DIR)
            .filter((f) => f.endsWith(".json") && !["sheet.json", "TEMPLATE.json"].includes(f))
            .map((f) => LabelFile.parse(JSON.parse(readFileSync(join(LABELS_DIR, f), "utf8"))))
        : [];
      const draft = {
        labeler: "draft",
        labels: Object.fromEntries(loadCases().map((c) => [c.id, c.label.option])),
      };
      if (files.length < 2)
        console.log(`${files.length} label file(s) in packages/eval/labels/; need at least 2 for agreement.`);
      else {
        const f = fleissKappa(files);
        console.log(`Fleiss' kappa ${f.kappa.toFixed(3)} over ${f.n} cases, ${f.raters} raters`);
        for (let i = 0; i < files.length; i++)
          for (let j = i + 1; j < files.length; j++) {
            const k = cohensKappa(files[i]!.labels, files[j]!.labels);
            console.log(
              `  ${files[i]!.labeler} vs ${files[j]!.labeler}: Cohen's kappa ${k.kappa.toFixed(3)} (n=${k.n})`,
            );
          }
        const d = disagreements(files);
        console.log(`${d.length} case(s) to settle:`);
        for (const x of d)
          console.log(
            `  ${x.caseId}: ${Object.entries(x.votes)
              .map(([who, v]) => `${who}=${v}`)
              .join(", ")}`,
          );
      }
      for (const file of files) {
        const k = cohensKappa(file.labels, draft.labels);
        console.log(`  ${file.labeler} vs current labels: Cohen's kappa ${k.kappa.toFixed(3)} (n=${k.n})`);
      }
      break;
    }
    default:
      console.error(
        `Unknown command ${cmd}. Use: run [--llm] | generate | calibrate | label-sheet | agreement`,
      );
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
