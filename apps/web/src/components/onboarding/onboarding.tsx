"use client";

import { CheckCircledIcon, ExclamationTriangleIcon, LockClosedIcon } from "@radix-ui/react-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { z } from "zod";
import { ErrorState, LoadingState } from "@/components/case-presenters";
import { PresetPicker } from "@/components/settings/policy-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { apiGet, apiSend } from "@/lib/api";
import { PRESETS, type PresetId } from "@/lib/policy-presets";
import { cn } from "@/lib/utils";

const ConnectionView = z
  .object({
    status: z.string(),
    config: z.record(z.string(), z.unknown()),
    hasSecret: z.boolean(),
    lastError: z.string().nullable(),
    verifiedAt: z.string().nullable(),
  })
  .nullable();
const State = z.object({
  merchant: z.object({ name: z.string(), onboardedAt: z.string().nullable() }).nullable(),
  mode: z.string(),
  encryptionReady: z.boolean(),
  paypal: ConnectionView,
  store: ConnectionView,
  policy: z.object({ saved: z.boolean(), updatedAt: z.string().nullable() }),
  cases: z.number(),
});
type State = z.infer<typeof State>;

const STEPS = ["Connect PayPal", "Connect your store", "Choose a policy", "First sync"] as const;

function Result({ ok, children }: { ok: boolean; children: ReactNode }) {
  const Icon = ok ? CheckCircledIcon : ExclamationTriangleIcon;
  return (
    <p
      className={cn("flex items-start gap-2 text-sm", ok ? "text-success" : "text-danger")}
      role={ok ? "status" : "alert"}
    >
      <Icon aria-hidden className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function StepCard({
  index,
  title,
  done,
  children,
}: {
  index: number;
  title: string;
  done: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`step-${index}`}
      className="rounded-[8px] border border-border bg-surface p-5 md:p-6"
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "mono grid size-8 shrink-0 place-items-center rounded-full border text-sm font-semibold",
            done ? "border-success/30 bg-success-soft text-success" : "border-border text-muted",
          )}
        >
          {done ? <CheckCircledIcon aria-label="done" /> : index + 1}
        </span>
        <h2 className="text-[15px] font-semibold text-foreground-strong" id={`step-${index}`}>
          {title}
        </h2>
      </div>
      <div className="mt-4 md:pl-11">{children}</div>
    </section>
  );
}

function PayPalStep({ state, onDone }: { state: State; onDone: () => void }) {
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const test = useMutation({
    mutationFn: () =>
      apiSend<{ message: string }>("POST", "onboarding/paypal", { clientId, clientSecret: secret }),
    onSuccess: () => {
      setSecret("");
      onDone();
    },
  });
  const saved = state.paypal;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    test.mutate();
  };
  return (
    <form className="grid gap-4" onSubmit={submit}>
      <p className="text-sm leading-6 text-muted">
        Use a REST app from the PayPal Developer dashboard, sandbox only. The secret is encrypted before it is
        stored and is never shown again.
      </p>
      {saved?.status === "VERIFIED" || saved?.status === "SAVED_UNCHECKED" ? (
        <Result ok>
          {saved.status === "VERIFIED"
            ? "Connected to the PayPal sandbox"
            : "Saved; simulator mode, not checked against PayPal"}{" "}
          · client {String(saved.config["clientIdHint"] ?? "")}
        </Result>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field htmlFor="pp-client" label="Sandbox client ID">
          <Input
            autoComplete="off"
            id="pp-client"
            onChange={(e) => setClientId(e.target.value)}
            spellCheck={false}
            value={clientId}
          />
        </Field>
        <Field htmlFor="pp-secret" label="Sandbox secret">
          <Input
            autoComplete="new-password"
            id="pp-secret"
            onChange={(e) => setSecret(e.target.value)}
            type="password"
            value={secret}
          />
        </Field>
      </div>
      {!state.encryptionReady ? (
        <Result ok={false}>
          Set CREDENTIALS_KEY on the api first, so the secret can be stored encrypted.
        </Result>
      ) : null}
      {test.error ? <Result ok={false}>{test.error.message}</Result> : null}
      {test.data ? <Result ok>{test.data.message}</Result> : null}
      <div>
        <Button
          disabled={
            clientId.trim().length < 10 ||
            secret.trim().length < 10 ||
            test.isPending ||
            !state.encryptionReady
          }
          type="submit"
          variant="primary"
        >
          <LockClosedIcon aria-hidden /> {test.isPending ? "Testing…" : "Test and save"}
        </Button>
      </div>
    </form>
  );
}

function StoreStep({ state, onDone }: { state: State; onDone: () => void }) {
  const [url, setUrl] = useState(String(state.store?.config["url"] ?? "http://127.0.0.1:3002"));
  const [token, setToken] = useState("");
  const test = useMutation({
    mutationFn: () =>
      apiSend<{ message: string }>("POST", "onboarding/store", { url, ...(token ? { token } : {}) }),
    onSuccess: () => {
      setToken("");
      onDone();
    },
  });
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        test.mutate();
      }}
    >
      <p className="text-sm leading-6 text-muted">
        Rebuttal reads orders, shipments, listing history and messages from your store to build evidence. The
        demo store runs on port 3002.
      </p>
      {state.store?.status === "VERIFIED" ? (
        <Result ok>
          Connected to {String(state.store.config["url"])} · {String(state.store.config["products"] ?? "?")}{" "}
          products
        </Result>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field htmlFor="store-url" label="Store URL">
          <Input
            id="store-url"
            inputMode="url"
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
            value={url}
          />
        </Field>
        <Field hint="Optional for the local demo store." htmlFor="store-token" label="Store API token">
          <Input
            autoComplete="new-password"
            id="store-token"
            onChange={(e) => setToken(e.target.value)}
            type="password"
            value={token}
          />
        </Field>
      </div>
      {test.error ? <Result ok={false}>{test.error.message}</Result> : null}
      {test.data ? <Result ok>{test.data.message}</Result> : null}
      <div>
        <Button disabled={!url.trim() || test.isPending} type="submit" variant="primary">
          {test.isPending ? "Testing…" : "Test and save"}
        </Button>
      </div>
    </form>
  );
}

function PolicyStep({ onDone }: { onDone: () => void }) {
  const [preset, setPreset] = useState<PresetId>("balanced");
  const save = useMutation({
    mutationFn: () => apiSend("POST", "onboarding/policy", { policy: PRESETS[preset].policy }),
    onSuccess: onDone,
  });
  return (
    <div className="grid gap-4">
      <p className="text-sm leading-6 text-muted">
        How much may Rebuttal do on its own? You can fine-tune every number in Settings later.
      </p>
      <PresetPicker onPick={setPreset} value={preset} />
      {save.error ? <Result ok={false}>{save.error.message}</Result> : null}
      {save.isSuccess ? <Result ok>{PRESETS[preset].label} policy saved.</Result> : null}
      <div>
        <Button disabled={save.isPending} onClick={() => save.mutate()} variant="primary">
          Use {PRESETS[preset].label}
        </Button>
      </div>
    </div>
  );
}

function SyncStep({ state, onDone }: { state: State; onDone: () => void }) {
  const sync = useMutation({
    mutationFn: () => apiSend<{ found: number }>("POST", "onboarding/sync"),
    onSuccess: onDone,
  });
  return (
    <div className="grid gap-4">
      <p className="text-sm leading-6 text-muted">
        Rebuttal asks PayPal for your open disputes, then gathers evidence and recommends an action for each
        one. New disputes arrive by webhook from then on.
      </p>
      {sync.error ? <Result ok={false}>{sync.error.message}</Result> : null}
      {sync.data ? (
        <div className="grid gap-3">
          <Result ok>
            Found {sync.data.found} open dispute{sync.data.found === 1 ? "" : "s"}. Evidence gathering has
            started.
          </Result>
          <Link className={cn(buttonVariants({ variant: "primary" }), "w-fit")} href="/queue">
            Go to the queue
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={sync.isPending} onClick={() => sync.mutate()} variant="primary">
            {sync.isPending ? "Syncing…" : "Run first sync"}
          </Button>
          {state.merchant?.onboardedAt ? (
            <span className="text-sm text-muted">Already synced once; running again is safe.</span>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function Onboarding() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["onboarding"], queryFn: () => apiGet("onboarding", State) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["onboarding"] });
  if (query.isLoading) return <LoadingState label="Loading setup" />;
  const s = query.data;
  if (!s) return <ErrorState message={query.error?.message ?? "Setup state unavailable"} />;
  const done = [
    s.paypal?.status === "VERIFIED" || s.paypal?.status === "SAVED_UNCHECKED",
    s.store?.status === "VERIFIED",
    s.policy.saved,
    !!s.merchant?.onboardedAt,
  ];
  return (
    <div className="grid gap-5">
      <ol aria-label="Progress" className="grid gap-2 sm:grid-cols-4">
        {STEPS.map((step, i) => (
          <li
            className={cn(
              "flex items-center gap-2 rounded-[6px] border px-3 py-2 text-xs font-semibold",
              done[i] ? "border-success/25 bg-success-soft text-success" : "border-border text-muted",
            )}
            key={step}
          >
            {done[i] ? <CheckCircledIcon aria-hidden /> : <span className="mono">{i + 1}</span>}
            {step}
          </li>
        ))}
      </ol>
      {s.mode === "simulator" ? (
        <p className="rounded-[6px] border border-border bg-surface-subdued px-4 py-3 text-sm text-muted">
          Simulator mode is on: Rebuttal is running against recorded PayPal data, so nothing here reaches
          PayPal.
        </p>
      ) : null}
      <StepCard done={done[0]!} index={0} title={STEPS[0]}>
        <PayPalStep onDone={refresh} state={s} />
      </StepCard>
      <StepCard done={done[1]!} index={1} title={STEPS[1]}>
        <StoreStep onDone={refresh} state={s} />
      </StepCard>
      <StepCard done={done[2]!} index={2} title={STEPS[2]}>
        <PolicyStep onDone={refresh} />
      </StepCard>
      <StepCard done={done[3]!} index={3} title={STEPS[3]}>
        <SyncStep onDone={refresh} state={s} />
      </StepCard>
    </div>
  );
}
