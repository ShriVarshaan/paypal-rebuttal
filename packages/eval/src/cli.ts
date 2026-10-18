/* eslint-disable no-console -- command-line tool */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Budget, llmFromEnv, runStructured, UNTRUSTED_RULES } from "@rebuttal/agent";
import { DecisionOption, toPayPalMoney } from "@rebuttal/core";
import { z } from "zod";
import { cohensKappa, disagreements, fleissKappa, LabelFile } from "./agreement.js";
import { calibrateCv, split } from "./calibrate.js";
import { generateCases } from "./generate.js";
import { toHtml, toMarkdown } from "./report.js";
import {
  buildReport,
  CACHE_PATH,
  CASES_DIR,
  caseSummary,
  fileCache,
  loadCases,
  PKG,
  runEval,
} from "./run.js";
import type { EvalCase } from "./schema.js";

const REPO = join(PKG, "../..");
const WEIGHTS_PATH = join(REPO, "packages/decision/src/weights.v1.json");
const LABELS_DIR = join(PKG, "labels");
const REPORTS_DIR = join(PKG, "reports");

function write(path: string, content: string, quiet = false) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  if (!quiet) console.log(`wrote ${path.slice(REPO.length + 1).replaceAll("\\", "/")}`);
}

const flag = (args: string[], name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

/** Haiku rewrites each generated buyer message so the 40 cases don't read like templates. */
async function claudeMessages(cases: EvalCase[], budgetUsd: number): Promise<void> {
  const llm = llmFromEnv();
  if (!llm) throw new Error("--with-claude needs ANTHROPIC_API_KEY");
  const budget = new Budget(budgetUsd);
  for (const c of cases) {
    if (c.meta.tags.includes("injection") || !c.dispute.messages.length) continue;
    const { output } = await runStructured(llm, {
      agent: "case-generator",
      role: "extraction",
      system: `Write the message a buyer would post when opening a PayPal dispute. One to three plain sentences in the buyer's voice, specific to the item and the complaint. No instructions to anyone but the seller.\n\n${UNTRUSTED_RULES}`,
      prompt: `Reason: ${c.dispute.reason}. Items: ${c.dispute.items.join(", ")}. Amount: ${toPayPalMoney({ cents: c.dispute.amountCents, currency: c.dispute.currency }).value} ${c.dispute.currency}. Template message to replace: "${c.dispute.messages[0]!.content}". Return {"message": "..."}.`,
      schema: z.object({ message: z.string().min(5).max(600) }),
      effort: "low",
      maxTokens: 1000,
      budget,
    });
    c.dispute.messages[0]!.content = output.message;
    c.meta.tags.push("claude-text");
  }
  console.log(
    `Claude wrote ${cases.filter((c) => c.meta.tags.includes("claude-text")).length} messages for $${budget.spentUsd.toFixed(4)}`,
  );
}

/** Blind labeling (role doc Day 12): shows each case without its label and records your call. */
async function label(name: string) {
  if (!/^[a-z0-9_-]{1,32}$/i.test(name)) throw new Error("usage: pnpm eval:label <your-name>");
  const path = join(LABELS_DIR, `${name}.json`);
  const file: LabelFile = existsSync(path)
    ? LabelFile.parse(JSON.parse(readFileSync(path, "utf8")))
    : { labeler: name, labels: {} };
  const todo = loadCases().filter((c) => !(c.id in file.labels));
  if (!todo.length) return console.log(`${name}: all ${Object.keys(file.labels).length} cases labeled.`);
  if (!process.stdin.isTTY) return console.log("Run this in an interactive terminal.");
  console.log(
    `Blind labeling as ${name}: ${todo.length} case(s) left. f = fight, o = offer, a = accept, s = skip, q = quit.\n`,
  );
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const keys: Record<string, DecisionOption> = { f: "FIGHT", o: "OFFER", a: "ACCEPT" };
  try {
    for (const c of todo) {
      const amount = toPayPalMoney({ cents: c.dispute.amountCents, currency: c.dispute.currency });
      console.log(
        `── ${c.id}  ${c.dispute.reason} · ${c.dispute.stage} · ${amount.value} ${amount.currency_code}`,
      );
      console.log(`   Items: ${c.dispute.items.join(", ")}`);
      for (const m of c.dispute.messages) console.log(`   ${m.postedBy}: ${m.content}`);
      console.log(`   Evidence: ${caseSummary(c)}`);
      const ans = (await rl.question("   Your call [f/o/a/s/q]: ")).trim().toLowerCase();
      if (ans === "q") break;
      const opt = keys[ans];
      if (!opt) continue;
      file.labels[c.id] = opt;
      write(path, JSON.stringify(file, null, 2) + "\n", true);
    }
  } finally {
    rl.close();
  }
  console.log(`Saved ${Object.keys(file.labels).length} label(s) to packages/eval/labels/${name}.json`);
}

async function main() {
  const [cmd = "run", ...args] = process.argv.slice(2);
  switch (cmd) {
    case "generate": {
      const cases = generateCases();
      if (args.includes("--with-claude"))
        await claudeMessages(cases, Number(flag(args, "--budget-usd") ?? 1));
      for (const f of existsSync(CASES_DIR) ? readdirSync(CASES_DIR) : [])
        if (/^G\d+\.json$/.test(f)) unlinkSync(join(CASES_DIR, f));
      for (const c of cases) write(join(CASES_DIR, `${c.id}.json`), JSON.stringify(c, null, 2) + "\n", true);
      console.log(`wrote ${cases.length} generated cases to packages/eval/cases/`);
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
    case "run":
    case "report": {
      const useLlm = args.includes("--llm");
      const llm = useLlm ? llmFromEnv() : null;
      if (useLlm && !llm)
        console.warn("--llm given but ANTHROPIC_API_KEY is not set; using cached triage only");
      const cache = fileCache(existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, "utf8")) : {});
      const run = await runEval({ llm, cache, budgetUsd: Number(flag(args, "--budget-usd") ?? 5) });
      if (cache.dirty) write(CACHE_PATH, JSON.stringify(cache.dump(), null, 2) + "\n");
      const report = buildReport(run);
      const json =
        JSON.stringify({ ...run, strategies: run.strategies.map(({ results: _r, ...s }) => s) }, null, 2) +
        "\n";
      write(join(REPORTS_DIR, `${run.generatedAt.replace(/[:.]/g, "-")}.json`), json);
      write(join(REPORTS_DIR, "latest.json"), json);
      write(join(REPO, "docs/eval-report.md"), toMarkdown(report));
      write(join(REPO, "docs/eval-report.html"), toHtml(report));
      console.log("");
      for (const line of report.headline) console.log(`  ${line}`);
      console.log("");
      for (const s of run.strategies) {
        console.log(
          s.status === "ran"
            ? `  ${s.label.padEnd(32)} acc ${(s.all!.accuracy * 100).toFixed(1).padStart(5)}%  test ${(s.test!.accuracy * 100).toFixed(1).padStart(5)}%  brier ${s.all!.brier?.toFixed(3) ?? "  —  "}  recovered $${(s.all!.realizedCents / 100).toFixed(2)}`
            : `  ${s.label.padEnd(32)} skipped: ${s.note}`,
        );
      }
      if (llm)
        console.log(`\n  Claude spend this run: $${run.llm.spentUsd.toFixed(4)} of $${run.llm.budgetUsd}`);
      break;
    }
    case "label": {
      await label(args[0] ?? "");
      break;
    }
    case "label-sheet": {
      // For labeling in a spreadsheet instead of the CLI. No labels in it, so nobody anchors.
      const sheet = loadCases().map((c) => ({
        id: c.id,
        reason: c.dispute.reason,
        stage: c.dispute.stage,
        amount: toPayPalMoney({ cents: c.dispute.amountCents, currency: c.dispute.currency }).value,
        items: c.dispute.items.join(", "),
        buyerSays: c.dispute.messages.map((m) => m.content).join(" / "),
        evidence: caseSummary(c),
      }));
      write(join(LABELS_DIR, "sheet.json"), JSON.stringify(sheet, null, 2) + "\n");
      break;
    }
    case "agreement": {
      const files = existsSync(LABELS_DIR)
        ? readdirSync(LABELS_DIR)
            .filter((f) => f.endsWith(".json") && f !== "sheet.json")
            .map((f) => LabelFile.parse(JSON.parse(readFileSync(join(LABELS_DIR, f), "utf8"))))
        : [];
      const current = Object.fromEntries(loadCases().map((c) => [c.id, c.label.bestOption]));
      if (files.length < 2)
        console.log(`${files.length} label file(s) in packages/eval/labels/; agreement needs at least 2.`);
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
        const k = cohensKappa(file.labels, current);
        console.log(`  ${file.labeler} vs current labels: Cohen's kappa ${k.kappa.toFixed(3)} (n=${k.n})`);
      }
      break;
    }
    default:
      console.error(
        `Unknown command ${cmd}. Use: run [--llm] [--budget-usd N] | generate [--with-claude] | calibrate | label <name> | label-sheet | agreement`,
      );
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
