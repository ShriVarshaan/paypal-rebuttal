"use client";

import {
  CheckCircledIcon,
  CrossCircledIcon,
  ExclamationTriangleIcon,
  FileTextIcon,
  LightningBoltIcon,
  MinusCircledIcon,
  Pencil1Icon,
  PlusCircledIcon,
  ReloadIcon,
  UpdateIcon,
} from "@radix-ui/react-icons";
import type { CaseDetail, DecisionRecord } from "@rebuttal/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { EvBars, type EvBar } from "@/components/charts/ev-bars";
import { WinMeter } from "@/components/charts/meter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/field";
import { useToast } from "@/components/ui/toaster";
import { apiSend } from "@/lib/api";
import { dateTime, formatMoney, offerTypeLabel, percent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ApproveDialog, EditDialog, OverrideDialog, RejectDialog } from "./decision-dialogs";
import { PackCard } from "./pack-card";

type Dialog = "approve" | "edit" | "override" | "reject" | null;

/** The decision the case is acting on: the newest one that was not rejected or superseded. */
export function currentDecision(value: CaseDetail): DecisionRecord | null {
  return value.decisions.find((d) => d.status !== "REJECTED") ?? null;
}

export function headline(
  d: Pick<DecisionRecord, "option" | "offerAmountCents" | "offerType">,
  currency: string,
) {
  if (d.option !== "OFFER") return d.option;
  const amount = d.offerAmountCents != null ? ` ${formatMoney(d.offerAmountCents, currency)}` : "";
  return `OFFER${amount}`;
}

function parseRationale(line: string): { label: string; value: number } | null {
  const m = /^(.*):\s*([+−-])(\d+(?:\.\d+)?)$/u.exec(line);
  return m ? { label: m[1]!, value: Number(m[3]) * (m[2] === "+" ? 1 : -1) } : null;
}

export function DecisionPanel({ value }: { value: CaseDetail }) {
  const decision = currentDecision(value);
  const [dialog, setDialog] = useState<Dialog>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const retriage = useMutation({
    mutationFn: () => apiSend("POST", `cases/${encodeURIComponent(value.id)}/triage`),
    onSuccess: () => {
      toast({
        tone: "info",
        title: "Re-running triage",
        body: "A new recommendation will appear in a few seconds.",
      });
      void queryClient.invalidateQueries({ queryKey: ["case", value.id] });
    },
    onError: (e) => toast({ tone: "danger", title: "Could not re-run triage", body: e.message }),
  });

  if (!decision)
    return (
      <section
        className="rounded-[8px] border border-border bg-surface p-5 md:p-6"
        aria-labelledby="decision-title"
      >
        <Eyebrow>Decision</Eyebrow>
        <h2 className="mt-2 text-lg font-semibold text-foreground-strong" id="decision-title">
          {value.state === "NEW" || value.state === "GATHERING"
            ? "Gathering evidence"
            : "No active recommendation"}
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
          {value.state === "NEW" || value.state === "GATHERING"
            ? "Rebuttal recommends an action once evidence collection finishes."
            : "The last recommendation was rejected. Re-run triage to compute a fresh one from the current evidence."}
        </p>
        {value.state !== "NEW" && value.state !== "GATHERING" ? (
          <Button className="mt-4" disabled={retriage.isPending} onClick={() => retriage.mutate()}>
            <ReloadIcon aria-hidden /> Re-run triage
          </Button>
        ) : null}
      </section>
    );

  const a = decision.analysis;
  const pWin = decision.pWin ?? a?.pWin ?? null;
  const ev = a?.ev;
  const proposed = decision.status === "PROPOSED";
  const bars: EvBar[] = [
    {
      key: "FIGHT",
      label: "Fight",
      detail: "Submit evidence: p(win) × amount recovered, minus fees and your time.",
      cents: ev?.fightCents ?? decision.evFight ?? 0,
    },
    ...((ev?.offer ?? decision.evOffer != null)
      ? [
          {
            key: "OFFER",
            label: "Offer",
            detail: ev?.offer
              ? `${offerTypeLabel(ev.offer.type)} of ${formatMoney(ev.offer.amountCents, value.currency)}; buyer accepts with p ≈ ${percent(ev.offer.pAccept)}.`
              : "Best partial-refund offer.",
            cents: ev?.offer?.evCents ?? decision.evOffer ?? 0,
          },
        ]
      : []),
    {
      key: "ACCEPT",
      label: "Accept",
      detail: "Refund in full now: no fees for fighting, no chance of recovery.",
      cents: ev?.acceptCents ?? decision.evAccept ?? 0,
    },
  ];
  const best = a?.chosen ?? decision.option;
  // The seller picked something other than the EV engine's choice.
  const overridden = !!a && a.chosen !== decision.option;
  const rationale = (a?.rationale ?? []).map(parseRationale).filter((r): r is NonNullable<typeof r> => !!r);
  const llm = a?.llm;
  const missing = value.checklist.items.filter((i) => i.status !== "found" && i.level !== "nice");
  const autoFiled = decision.status === "AUTO_APPROVED";
  const latestAction = [...value.actions].reverse().find((x) => x.decisionId === decision.id);

  return (
    <section
      aria-labelledby="decision-title"
      className="rounded-[8px] border border-border bg-surface"
      id="decision"
    >
      <div className="flex flex-col gap-4 border-b border-border p-5 md:flex-row md:items-start md:justify-between md:p-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Eyebrow>{overridden ? "Your decision" : "Recommendation"}</Eyebrow>
            <StatusBadge decision={decision} caseState={value.state} />
            {autoFiled ? (
              <Badge tone="accent" title={a?.autonomy.reasons.join("; ")}>
                <LightningBoltIcon aria-hidden />
                {decision.reason === "DEADLINE"
                  ? "Auto-filed · deadline safe default"
                  : "Auto-filed by policy"}
              </Badge>
            ) : null}
          </div>
          <h2
            className="mono mt-2 text-[34px] font-semibold leading-[40px] tracking-[-0.03em] text-foreground-strong"
            id="decision-title"
          >
            {headline(decision, value.currency)}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {overridden
              ? `You overrode Rebuttal's recommendation (${a.chosen}); the expected values below are unchanged`
              : decision.option === "OFFER"
                ? `${offerTypeLabel(decision.offerType)} instead of fighting or refunding in full`
                : decision.option === "FIGHT"
                  ? "Contest the dispute with a cited evidence pack"
                  : "Refund in full: fighting is expected to cost more than it recovers"}
            {" · "}
            <span className="mono text-xs">{decision.modelVersion ?? "engine"}</span>
          </p>
          {autoFiled && a?.autonomy.reasons.length ? (
            <p className="mt-2 text-xs text-muted">Rule applied: {a.autonomy.reasons.join("; ")}</p>
          ) : null}
        </div>
        {proposed ? (
          <div className="flex flex-wrap gap-2 md:justify-end">
            <Button onClick={() => setDialog("approve")} variant="primary">
              <CheckCircledIcon aria-hidden /> Approve &amp; file
            </Button>
            <Button onClick={() => setDialog("edit")}>
              <Pencil1Icon aria-hidden /> Edit
            </Button>
            <Button onClick={() => setDialog("override")}>
              <UpdateIcon aria-hidden /> Override
            </Button>
            <Button onClick={() => setDialog("reject")} variant="ghost">
              <CrossCircledIcon aria-hidden /> Reject
            </Button>
          </div>
        ) : (
          <FilingState
            caseState={value.state}
            decision={decision}
            latestAction={latestAction}
            onRetriage={() => retriage.mutate()}
          />
        )}
      </div>

      <div className="grid gap-6 p-5 md:p-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="grid content-start gap-6">
          {pWin != null ? (
            <WinMeter model={a?.pWinModel ?? null} value={pWin} />
          ) : (
            <p className="text-sm text-muted">No win probability recorded.</p>
          )}
          {llm ? (
            <div className="rounded-[6px] border border-border bg-surface-subdued p-3 text-sm leading-6">
              <p className="text-xs font-semibold text-foreground-strong">Claude review</p>
              {llm.applied && llm.delta !== 0 ? (
                <p className="mt-1">
                  Adjusted p(win){" "}
                  <span className="mono font-semibold">
                    {llm.delta > 0 ? "+" : "−"}
                    {Math.abs(llm.delta).toFixed(2)}
                  </span>{" "}
                  because {llm.reason.replace(/\.$/, "")}
                  {llm.exhibits.length ? (
                    <span className="mono text-xs text-accent-strong"> [{llm.exhibits.join(", ")}]</span>
                  ) : null}
                  .
                </p>
              ) : (
                <p className="mt-1 text-muted">
                  {llm.ignoredBecause
                    ? `Suggestion ignored: ${llm.ignoredBecause}.`
                    : "No adjustment; the model's estimate stands."}
                </p>
              )}
              <p className="mt-1 text-xs text-muted">
                Adjustments are capped at ±0.10 and must cite exhibits. The EV engine still chooses.
              </p>
            </div>
          ) : null}
          <div>
            <p className="text-xs font-semibold text-muted">Evidence completeness</p>
            <p className="mono mt-1 text-lg font-semibold text-foreground-strong">
              {percent(value.checklist.score)}
            </p>
            {missing.length ? (
              <ul className="mt-2 space-y-1 text-sm">
                {missing.map((m) => (
                  <li className="flex items-start gap-2" key={m.id}>
                    <ExclamationTriangleIcon
                      aria-hidden
                      className={cn("mt-1 shrink-0", m.level === "required" ? "text-danger" : "text-warning")}
                    />
                    <a
                      className="text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-accent"
                      href={`#req-${m.id}`}
                    >
                      {m.label}
                    </a>
                    <span className="text-xs text-muted">
                      ({m.level}, {m.status})
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted">Every required and strong item is present.</p>
            )}
          </div>
        </div>

        <div className="grid content-start gap-6">
          <div>
            <p className="text-xs font-semibold text-muted">
              Expected value vs refunding in full{overridden ? ` · highlighted: Rebuttal's pick` : ""}
            </p>
            <div className="mt-3">
              <EvBars best={best} bars={bars} currency={value.currency} />
            </div>
          </div>
          {rationale.length ? (
            <div>
              <p className="text-xs font-semibold text-muted">
                Why (contribution to the win model, log-odds)
              </p>
              <ul className="mt-2 divide-y divide-border rounded-[6px] border border-border">
                {rationale.slice(0, 8).map((r) => (
                  <li className="flex items-center gap-3 px-3 py-2 text-sm" key={r.label}>
                    {r.value >= 0 ? (
                      <PlusCircledIcon aria-label="raises" className="shrink-0 text-success" />
                    ) : (
                      <MinusCircledIcon aria-label="lowers" className="shrink-0 text-danger" />
                    )}
                    <span className="min-w-0 flex-1">{r.label}</span>
                    <span className="mono text-xs text-muted">
                      {r.value >= 0 ? "+" : "−"}
                      {Math.abs(r.value).toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : decision.rationale ? (
            <p className="text-sm leading-6 text-muted">{decision.rationale}</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 border-t border-border p-5 md:p-6 lg:grid-cols-2">
        <Statement decision={decision} />
        {decision.option === "FIGHT" ? (
          <PackCard decision={decision} value={value} />
        ) : (
          <NoteCard decision={decision} />
        )}
      </div>

      <ApproveDialog
        decision={decision}
        onClose={() => setDialog(null)}
        open={dialog === "approve"}
        value={value}
      />
      <EditDialog
        decision={decision}
        onClose={() => setDialog(null)}
        open={dialog === "edit"}
        value={value}
      />
      <OverrideDialog
        decision={decision}
        onClose={() => setDialog(null)}
        open={dialog === "override"}
        value={value}
      />
      <RejectDialog
        decision={decision}
        onClose={() => setDialog(null)}
        open={dialog === "reject"}
        value={value}
      />
    </section>
  );
}

function StatusBadge({ decision, caseState }: { decision: DecisionRecord; caseState: CaseDetail["state"] }) {
  switch (decision.status) {
    case "PROPOSED":
      return <Badge tone="warning">Needs approval</Badge>;
    case "APPROVED":
    case "AUTO_APPROVED":
      return <Badge tone="accent">{caseState === "FILING" ? "Filing" : "Approved"}</Badge>;
    case "EXECUTED":
      return <Badge tone="success">Filed</Badge>;
    case "FAILED":
      return <Badge tone="danger">Filing failed</Badge>;
    default:
      return <Badge>{decision.status.toLowerCase()}</Badge>;
  }
}

function FilingState({
  decision,
  caseState,
  latestAction,
  onRetriage,
}: {
  decision: DecisionRecord;
  caseState: CaseDetail["state"];
  latestAction: CaseDetail["actions"][number] | undefined;
  onRetriage: () => void;
}) {
  if (decision.status === "FAILED")
    return (
      <div
        className="max-w-sm rounded-[6px] border border-danger/25 bg-danger-soft p-3 text-sm text-danger"
        role="alert"
      >
        <p className="font-semibold">PayPal did not accept the filing.</p>
        <p className="mt-1">{latestAction?.errorMessage ?? "See the timeline for details."}</p>
        {latestAction?.debugId ? <p className="mono mt-1 text-xs">debug_id {latestAction.debugId}</p> : null}
        <Button className="mt-3" onClick={onRetriage} size="compact">
          <ReloadIcon aria-hidden /> Re-run triage
        </Button>
      </div>
    );
  if (decision.status === "EXECUTED")
    return (
      <div className="flex items-center gap-2 text-sm text-success">
        <CheckCircledIcon aria-hidden />
        Filed with PayPal{latestAction?.completedAt ? ` ${dateTime(latestAction.completedAt)}` : ""}
      </div>
    );
  return (
    <div className="flex items-center gap-2 text-sm text-foreground" role="status">
      <span
        aria-hidden
        className="size-4 animate-spin rounded-full border-2 border-border border-t-accent motion-reduce:animate-none"
      />
      {caseState === "FILING"
        ? latestAction
          ? "Submitting to PayPal…"
          : "Waiting for the evidence PDF, then filing…"
        : `Approved by ${decision.approvedBy ?? "seller"}${decision.approvedAt ? ` · ${dateTime(decision.approvedAt)}` : ""}`}
    </div>
  );
}

function Statement({ decision }: { decision: DecisionRecord }) {
  const n = decision.narrative;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted">
          {n?.claims.length ? "Seller statement" : "Note sent to PayPal"}
        </p>
        {n?.needsReview ? (
          <Badge tone="warning">Needs your review</Badge>
        ) : n ? (
          <Badge>{n.source === "claude" ? "Drafted by Claude" : "Template"}</Badge>
        ) : null}
      </div>
      {n?.claims.length ? (
        <div className="mt-2 border-l-2 border-accent pl-3 text-sm leading-6">
          <p className="font-semibold text-foreground-strong">{n.headline}</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            {n.claims.map((c, i) => (
              <li key={i}>
                {c.text}{" "}
                <span className="mono text-xs font-semibold text-accent-strong">
                  [{c.exhibits.join(", ")}]
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-wrap border-l-2 border-accent pl-3 text-sm leading-6">
          {decision.note}
        </p>
      )}
    </div>
  );
}

function NoteCard({ decision }: { decision: DecisionRecord }) {
  return (
    <div className="rounded-[6px] border border-border bg-surface-subdued p-4">
      <div className="flex items-center gap-2">
        <FileTextIcon aria-hidden className="text-muted" />
        <p className="text-xs font-semibold text-foreground-strong">No evidence pack needed</p>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted">
        {decision.option === "OFFER"
          ? "An offer goes to PayPal as a make-offer request with the note shown. If the buyer declines, the case returns to triage."
          : "Accepting the claim refunds the buyer through PayPal's accept-claim endpoint. Nothing else is submitted."}
      </p>
    </div>
  );
}
