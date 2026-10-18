import { DecisionOption } from "@rebuttal/core";
import { z } from "zod";

/** One teammate's independent labels: packages/eval/labels/<name>.json (plan Day 12). */
export const LabelFile = z.object({
  labeler: z.string(),
  labels: z.record(z.string(), DecisionOption),
});
export type LabelFile = z.infer<typeof LabelFile>;

const CATS = DecisionOption.options;

/** Cohen's kappa for two raters over the cases both labeled. */
export function cohensKappa(
  a: Record<string, string>,
  b: Record<string, string>,
): { kappa: number; n: number } {
  const ids = Object.keys(a).filter((id) => id in b);
  const n = ids.length;
  if (!n) return { kappa: NaN, n };
  const po = ids.filter((id) => a[id] === b[id]).length / n;
  const pe = CATS.reduce(
    (s, k) => s + (ids.filter((id) => a[id] === k).length / n) * (ids.filter((id) => b[id] === k).length / n),
    0,
  );
  return { kappa: pe === 1 ? 1 : (po - pe) / (1 - pe), n };
}

/** Fleiss' kappa for any number of raters, over cases every rater labeled. */
export function fleissKappa(files: LabelFile[]): { kappa: number; n: number; raters: number } {
  const raters = files.length;
  const ids = Object.keys(files[0]?.labels ?? {}).filter((id) => files.every((f) => id in f.labels));
  const n = ids.length;
  if (raters < 2 || !n) return { kappa: NaN, n, raters };
  const counts = ids.map((id) => CATS.map((k) => files.filter((f) => f.labels[id] === k).length));
  const P = counts.map((row) => row.reduce((s, c) => s + c * (c - 1), 0) / (raters * (raters - 1)));
  const Pbar = P.reduce((s, p) => s + p, 0) / n;
  const pj = CATS.map((_, j) => counts.reduce((s, row) => s + row[j]!, 0) / (n * raters));
  const Pe = pj.reduce((s, p) => s + p * p, 0);
  return { kappa: Pe === 1 ? 1 : (Pbar - Pe) / (1 - Pe), n, raters };
}

/** Cases where the labelers don't all agree, for the settle-disagreements session. */
export function disagreements(files: LabelFile[]): { caseId: string; votes: Record<string, string> }[] {
  const ids = [...new Set(files.flatMap((f) => Object.keys(f.labels)))].sort();
  return ids
    .map((id) => ({
      caseId: id,
      votes: Object.fromEntries(files.flatMap((f) => (id in f.labels ? [[f.labeler, f.labels[id]!]] : []))),
    }))
    .filter((d) => new Set(Object.values(d.votes)).size > 1);
}
