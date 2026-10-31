"use client";

import { CheckIcon, ResetIcon } from "@radix-ui/react-icons";
import { Policy, type DecisionOption } from "@rebuttal/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { z } from "zod";
import { ErrorState, LoadingState } from "@/components/case-presenters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toaster";
import { apiGet, apiSend } from "@/lib/api";
import { formatMoney, relativeTime } from "@/lib/format";
import { matchPreset, PRESETS, type PresetId } from "@/lib/policy-presets";
import { cn } from "@/lib/utils";

const PolicyResponse = z.object({ policy: Policy, isDefault: z.boolean(), updatedAt: z.string().nullable() });

const REASONS: [string, string][] = [
  ["MERCHANDISE_OR_SERVICE_NOT_RECEIVED", "Not received"],
  ["MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", "Not as described"],
  ["UNAUTHORISED", "Unauthorised"],
  ["DUPLICATE_TRANSACTION", "Duplicate transaction"],
  ["CREDIT_NOT_PROCESSED", "Credit not processed"],
  ["CANCELED_RECURRING_BILLING", "Cancelled recurring billing"],
  ["INCORRECT_AMOUNT", "Incorrect amount"],
];
const OPTIONS: [DecisionOption, string][] = [
  ["FIGHT", "Fight with evidence"],
  ["OFFER", "Offer a partial refund"],
  ["ACCEPT", "Accept and refund"],
];

/** Number input bound to a value shown in display units (dollars, percent) but stored raw. */
function NumberField({
  id,
  label,
  hint,
  value,
  onChange,
  scale = 1,
  min = 0,
  max,
  step = "any",
  suffix,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  value: number;
  onChange: (v: number) => void;
  scale?: number;
  min?: number;
  max?: number;
  step?: string;
  suffix?: string;
}) {
  const [text, setText] = useState(String(+(value / scale).toFixed(4)));
  useEffect(() => setText(String(+(value / scale).toFixed(4))), [value, scale]);
  const n = Number(text);
  const error =
    text === "" || !Number.isFinite(n) || n < min || (max != null && n > max)
      ? `Enter ${min}–${max ?? "∞"}`
      : null;
  return (
    <Field error={error} hint={hint} htmlFor={id} label={label}>
      <div className="relative">
        <Input
          aria-invalid={!!error}
          id={id}
          inputMode="decimal"
          max={max}
          min={min}
          onBlur={() => !error && onChange(Math.round(n * scale * 1e6) / 1e6)}
          onChange={(e) => {
            setText(e.target.value);
            const v = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(v) && v >= min && (max == null || v <= max))
              onChange(Math.round(v * scale * 1e6) / 1e6);
          }}
          step={step}
          type="number"
          value={text}
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
            {suffix}
          </span>
        ) : null}
      </div>
    </Field>
  );
}

function Check({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[6px] py-2 text-sm">
      <input
        checked={checked}
        className="mt-1 size-4 accent-[var(--accent)]"
        onChange={(e) => onChange(e.target.checked)}
        type="checkbox"
      />
      <span>
        <span className="font-medium text-foreground-strong">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs leading-5 text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-5 border-t border-border py-7 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div>
        <h2 className="text-[15px] font-semibold text-foreground-strong">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
      </div>
      <div className="grid content-start gap-4">{children}</div>
    </section>
  );
}

export function PresetPicker({ value, onPick }: { value: PresetId | null; onPick: (id: PresetId) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Policy preset">
      {(Object.keys(PRESETS) as PresetId[]).map((id) => (
        <button
          aria-checked={value === id}
          className={cn(
            "rounded-[8px] border p-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
            value === id
              ? "border-accent bg-accent-soft"
              : "border-border bg-surface hover:border-border-strong",
          )}
          key={id}
          onClick={() => onPick(id)}
          role="radio"
          type="button"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-foreground-strong">{PRESETS[id].label}</span>
            {value === id ? <CheckIcon aria-hidden className="text-accent-strong" /> : null}
          </span>
          <span className="mt-1.5 block text-xs leading-5 text-muted">{PRESETS[id].summary}</span>
        </button>
      ))}
    </div>
  );
}

export function PolicyForm() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ["policy"], queryFn: () => apiGet("policy", PolicyResponse) });
  const [draft, setDraft] = useState<Policy | null>(null);
  useEffect(() => {
    if (query.data && !draft) setDraft(query.data.policy);
  }, [query.data, draft]);
  const save = useMutation({
    mutationFn: (policy: Policy) => apiSend("PUT", "policy", { policy, updatedBy: "seller" }),
    onSuccess: () => {
      toast({ tone: "success", title: "Policy saved", body: "New triage decisions use it immediately." });
      void queryClient.invalidateQueries({ queryKey: ["policy"] });
    },
  });
  const validation = useMemo(() => (draft ? Policy.safeParse(draft) : null), [draft]);
  const dirty = !!draft && !!query.data && JSON.stringify(draft) !== JSON.stringify(query.data.policy);

  if (query.isLoading || (!draft && !query.error)) return <LoadingState label="Loading policy" />;
  if (query.error || !draft) return <ErrorState message={query.error?.message ?? "Policy unavailable"} />;

  const set = (patch: (p: Policy) => Policy) => setDraft((p) => (p ? patch(structuredClone(p)) : p));
  const a = draft.autonomy;
  const e = draft.economics;
  const laborPerFight = (e.laborCostPerHourCents * e.fightMinutes) / 60;
  const preset = matchPreset(draft);

  return (
    <form
      className="pb-24"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (validation?.success) save.mutate(validation.data);
      }}
    >
      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm text-muted">
        {query.data?.isDefault ? <Badge>Using defaults</Badge> : <Badge tone="accent">Saved policy</Badge>}
        {query.data?.updatedAt ? <span>Last saved {relativeTime(query.data.updatedAt)}</span> : null}
      </div>
      <Section description="Start from a preset, then fine-tune below." title="Preset">
        <PresetPicker onPick={(id) => setDraft(structuredClone(PRESETS[id].policy))} value={preset} />
      </Section>

      <Section
        description="When Rebuttal may file without asking. Every decision is computed the same way; this only decides who presses the button."
        title="Autonomy"
      >
        <Check
          checked={a.enabled}
          hint="Off means every decision waits for you (except the deadline safe default)."
          label="Let Rebuttal file eligible decisions on its own"
          onChange={(v) => set((p) => ((p.autonomy.enabled = v), p))}
        />
        <div className={cn("grid gap-4 sm:grid-cols-2", !a.enabled && "opacity-60")}>
          <NumberField
            hint="Disputes at or above this amount always need you."
            id="max-amount"
            label="Auto-file only below"
            onChange={(v) => set((p) => ((p.autonomy.maxAmountCents = v), p))}
            scale={100}
            suffix="USD"
            value={a.maxAmountCents}
          />
          <NumberField
            hint="A fight auto-files only when the win probability reaches this."
            id="min-pwin"
            label="Minimum p(win) to fight"
            max={100}
            onChange={(v) => set((p) => ((p.autonomy.minPWinToFight = v), p))}
            scale={0.01}
            suffix="%"
            value={a.minPWinToFight}
          />
          <NumberField
            id="min-completeness"
            label="Minimum evidence completeness to fight"
            max={100}
            onChange={(v) => set((p) => ((p.autonomy.minCompletenessToFight = v), p))}
            scale={0.01}
            suffix="%"
            value={a.minCompletenessToFight}
          />
        </div>
        <fieldset className={cn("grid gap-1", !a.enabled && "opacity-60")}>
          <legend className="text-xs font-semibold text-foreground-strong">
            Actions Rebuttal may file without approval
          </legend>
          {OPTIONS.map(([o, label]) => (
            <Check
              checked={a.options.includes(o)}
              key={o}
              label={label}
              onChange={(v) =>
                set(
                  (p) => (
                    (p.autonomy.options = v
                      ? [...p.autonomy.options, o]
                      : p.autonomy.options.filter((x) => x !== o)),
                    p
                  ),
                )
              }
            />
          ))}
          <Check
            checked={a.requireCompleteEvidence}
            hint="Never auto-file a fight with a required piece of evidence missing."
            label="Require complete evidence to auto-fight"
            onChange={(v) => set((p) => ((p.autonomy.requireCompleteEvidence = v), p))}
          />
        </fieldset>
        <fieldset className="grid gap-1 sm:grid-cols-2">
          <legend className="mb-1 text-xs font-semibold text-foreground-strong">
            Reasons that always need your approval
          </legend>
          {REASONS.map(([reason, label]) => (
            <Check
              checked={a.requireApprovalReasons.includes(reason)}
              key={reason}
              label={label}
              onChange={(v) =>
                set(
                  (p) => (
                    (p.autonomy.requireApprovalReasons = v
                      ? [...p.autonomy.requireApprovalReasons, reason]
                      : p.autonomy.requireApprovalReasons.filter((x) => x !== reason)),
                    p
                  ),
                )
              }
            />
          ))}
        </fieldset>
      </Section>

      <Section
        description="If nobody approves in time, Rebuttal files the safe choice: the EV pick, or accept when a fight lacks required evidence. Missing a deadline loses the money for certain."
        title="Deadline safe default"
      >
        <NumberField
          hint="Reminders still arrive at 72h, 24h and 6h."
          id="deadline-hours"
          label="File the safe default this many hours before the deadline"
          max={168}
          onChange={(v) => set((p) => ((p.deadlineAutoApproveHours = v), p))}
          step="1"
          suffix="hours"
          value={draft.deadlineAutoApproveHours}
        />
      </Section>

      <Section
        description="The costs the expected-value math weighs. Defaults are documented assumptions; replace them with your own numbers."
        title="Costs and risk"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            hint="What PayPal charges when you fight and lose."
            id="loss-fee"
            label="Dispute / chargeback fee"
            onChange={(v) => set((p) => ((p.economics.lossFeeCents = v), p))}
            scale={100}
            suffix="USD"
            value={e.lossFeeCents}
          />
          <NumberField
            id="labor-rate"
            label="Your time, per hour"
            onChange={(v) => set((p) => ((p.economics.laborCostPerHourCents = v), p))}
            scale={100}
            suffix="USD/h"
            value={e.laborCostPerHourCents}
          />
          <NumberField
            hint={`Labor cost per fought case: ${formatMoney(Math.round(laborPerFight), "USD")}`}
            id="fight-minutes"
            label="Minutes you spend on a fought case"
            onChange={(v) => set((p) => ((p.economics.fightMinutes = v), p))}
            suffix="min"
            value={e.fightMinutes}
          />
          <NumberField
            id="offer-minutes"
            label="Minutes on an offer"
            onChange={(v) => set((p) => ((p.economics.offerMinutes = v), p))}
            suffix="min"
            value={e.offerMinutes}
          />
          <NumberField
            hint="Cost of one more lost dispute when your dispute rate sits at PayPal's review threshold."
            id="risk-weight"
            label="Risk weight (account health)"
            onChange={(v) => set((p) => ((p.economics.ratioPenaltyCents = v), p))}
            scale={100}
            suffix="USD"
            value={e.ratioPenaltyCents}
          />
          <NumberField
            id="dispute-ratio"
            label="Your current dispute rate"
            max={100}
            onChange={(v) => set((p) => ((p.economics.disputeRatio = v), p))}
            scale={0.01}
            suffix="%"
            value={e.disputeRatio}
          />
        </div>
      </Section>

      <Section
        description="Claude may nudge p(win) by at most ±0.10, citing exhibits. The EV engine always makes the choice."
        title="AI review"
      >
        <Check
          checked={draft.llm.enabled}
          label="Let Claude review each case before the decision"
          onChange={(v) => set((p) => ((p.llm.enabled = v), p))}
        />
        <Field
          hint="Calibrated weights were tuned on the eval train split."
          htmlFor="win-model"
          label="Win model"
        >
          <Select
            id="win-model"
            onChange={(ev) => set((p) => ((p.winModel = ev.target.value as Policy["winModel"]), p))}
            value={draft.winModel}
          >
            <option value="hand">Hand-set weights (v0)</option>
            <option value="calibrated">Calibrated weights (v1)</option>
          </Select>
        </Field>
      </Section>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-canvas/95 px-4 py-3 backdrop-blur-sm md:left-56 md:px-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <p aria-live="polite" className={cn("text-sm", validation?.success ? "text-muted" : "text-danger")}>
            {!validation?.success
              ? `Fix: ${validation?.error.issues.map((i) => i.path.join(".")).join(", ")}`
              : save.error
                ? `Not saved: ${save.error.message}`
                : dirty
                  ? "Unsaved changes"
                  : "All changes saved"}
          </p>
          <div className="flex gap-2">
            <Button
              disabled={!dirty}
              onClick={() => setDraft(query.data!.policy)}
              type="button"
              variant="ghost"
            >
              <ResetIcon aria-hidden /> Discard
            </Button>
            <Button
              disabled={!dirty || !validation?.success || save.isPending}
              type="submit"
              variant="primary"
            >
              {save.isPending ? "Saving…" : "Save policy"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
