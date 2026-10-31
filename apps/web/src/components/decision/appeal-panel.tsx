"use client";

import { AppealDraft, type CaseDetail } from "@rebuttal/core";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Eyebrow } from "@/components/ui/field";
import { dateTime } from "@/lib/format";

const Payload = z.object({ draft: AppealDraft }).loose();

/**
 * B's appeal draft for a lost case (APPEAL_DRAFTED event): why it was lost and what new
 * evidence an appeal would need. Filing the appeal stays the seller's call.
 */
export function AppealPanel({ value }: { value: CaseDetail }) {
  const event = [...value.events].reverse().find((e) => e.type === "APPEAL_DRAFTED");
  const parsed = event ? Payload.safeParse(event.payload) : null;
  if (!event || !parsed?.success) return null;
  const d = parsed.data.draft;
  return (
    <section
      aria-labelledby="appeal-title"
      className="rounded-[8px] border border-border bg-surface p-5 md:p-6"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>Appeal draft</Eyebrow>
        <Badge tone={d.recommendAppeal ? "accent" : "neutral"}>
          {d.recommendAppeal ? "Appeal recommended" : "Appeal not recommended"}
        </Badge>
        <Badge>{d.source === "claude" ? "Drafted by Claude" : "Template"}</Badge>
      </div>
      <h2 className="mt-2 text-lg font-semibold text-foreground-strong" id="appeal-title">
        Why this dispute was lost
      </h2>
      <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm leading-6">{d.lossAnalysis}</p>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <p className="text-xs font-semibold text-muted">New evidence an appeal needs</p>
          {d.newEvidenceNeeded.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">
              {d.newEvidenceNeeded.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">Nothing new was identified.</p>
          )}
        </div>
        {d.claims.length ? (
          <div>
            <p className="text-xs font-semibold text-muted">Draft appeal statement</p>
            <ol className="mt-2 list-decimal space-y-1 border-l-2 border-accent pl-8 text-sm leading-6">
              {d.claims.map((c, i) => (
                <li key={i}>
                  {c.text}{" "}
                  <span className="mono text-xs font-semibold text-accent-strong">
                    [{c.exhibits.join(", ")}]
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
      <p className="mt-5 text-xs text-muted">
        Drafted {dateTime(typeof event.createdAt === "string" ? event.createdAt : null)}. Rebuttal does not
        file appeals on its own; review the draft and file it from PayPal&apos;s Resolution Center if you
        agree.
      </p>
    </section>
  );
}
