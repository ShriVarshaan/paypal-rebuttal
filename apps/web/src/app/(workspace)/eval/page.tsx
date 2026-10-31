import type { Metadata } from "next";
import { EvalReport } from "@/components/eval/eval-report";

export const metadata: Metadata = { title: "Eval" };

export default function EvalPage() {
  return (
    <div className="mx-auto max-w-[1500px]">
      <p className="text-[11px] font-bold uppercase tracking-[0.055em] text-accent-strong">Evaluation</p>
      <h1 className="mt-2 text-[28px] font-semibold leading-[34px] tracking-[-0.025em] text-foreground-strong">
        How well does Rebuttal decide?
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
        Every strategy scored on the same labelled disputes, weights tuned on the train split only. From
        B&apos;s latest <code className="mono text-xs">pnpm eval</code> report.
      </p>
      <div className="mt-7">
        <EvalReport />
      </div>
    </div>
  );
}
