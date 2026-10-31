"use client";

import { Cross2Icon, PlusIcon } from "@radix-ui/react-icons";
import { minorUnitDigits, type CaseDetail, type DecisionRecord, type NarrativeClaim } from "@rebuttal/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toaster";
import { apiSend } from "@/lib/api";
import { formatMoney, offerTypeLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  decision: DecisionRecord;
  value: CaseDetail;
}

const ACTOR = "seller";
const OFFER_TYPES = ["REFUND", "REFUND_WITH_RETURN", "REFUND_WITH_REPLACEMENT"] as const;

function useDecisionMutation<T extends object>(
  value: CaseDetail,
  run: (body: T) => Promise<unknown>,
  success: string,
) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      toast({ tone: "success", title: success });
      void queryClient.invalidateQueries({ queryKey: ["case", value.id] });
      void queryClient.invalidateQueries({ queryKey: ["cases"] });
    },
  });
}

const toMinor = (text: string, currency: string): number | null => {
  const n = Number(text.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10 ** minorUnitDigits(currency)) : null;
};
const fromMinor = (cents: number | null, currency: string) =>
  cents == null ? "" : (cents / 10 ** minorUnitDigits(currency)).toFixed(minorUnitDigits(currency));

/** Approve & file: an in-page confirmation that names exactly what PayPal will receive. */
export function ApproveDialog({ open, onClose, decision, value }: DialogProps) {
  const approve = useDecisionMutation(
    value,
    () => apiSend("POST", `decisions/${encodeURIComponent(decision.id)}/approve`, { approvedBy: ACTOR }),
    "Approved. Rebuttal is filing it with PayPal.",
  );
  const pack = value.pack?.decisionId === decision.id ? value.pack : null;
  const amount = formatMoney(value.amountCents, value.currency);
  const what =
    decision.option === "FIGHT"
      ? pack?.status === "READY"
        ? `This will submit ${pack.files.length} evidence file${pack.files.length === 1 ? "" : "s"} (${pack.exhibits.length} exhibits) and your statement to PayPal for dispute ${value.paypalDisputeId}.`
        : `This will submit your statement and evidence to PayPal for dispute ${value.paypalDisputeId}. The PDF is still being built; Rebuttal files it as soon as it is ready, or files without it two hours before the deadline.`
      : decision.option === "OFFER"
        ? `This will send the buyer an offer of ${formatMoney(decision.offerAmountCents ?? 0, value.currency)} (${offerTypeLabel(decision.offerType).toLowerCase()}) through PayPal for dispute ${value.paypalDisputeId}. The buyer can accept or decline.`
        : `This will accept the claim for dispute ${value.paypalDisputeId}; PayPal refunds the buyer ${amount}. This cannot be undone.`;
  return (
    <Modal
      description={what}
      footer={
        <>
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={approve.isPending}
            onClick={() => approve.mutate({}, { onSuccess: onClose })}
            variant="primary"
          >
            {approve.isPending
              ? "Approving…"
              : decision.option === "ACCEPT"
                ? "Accept and refund"
                : "Approve and file"}
          </Button>
        </>
      }
      onOpenChange={(o) => (o ? null : onClose())}
      open={open}
      title={decision.option === "ACCEPT" ? "Accept this claim?" : "Approve and file with PayPal?"}
    >
      <div className="grid gap-2 text-sm">
        <p className="text-muted">Note PayPal receives with this action:</p>
        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-[6px] border border-border bg-surface-subdued p-3 leading-6">
          {decision.note}
        </p>
        {decision.narrative?.needsReview ? (
          <p className="text-warning" role="alert">
            The statement needs your review: Claude&apos;s draft failed validation and a template was used.
            Consider editing it first.
          </p>
        ) : null}
        {approve.error ? (
          <p className="text-danger" role="alert">
            {approve.error.message}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** Reject: the reason goes into the case's audit trail. */
export function RejectDialog({ open, onClose, decision, value }: DialogProps) {
  const [reason, setReason] = useState("");
  const reject = useDecisionMutation(
    value,
    (body: { reason: string }) =>
      apiSend("POST", `decisions/${encodeURIComponent(decision.id)}/reject`, { by: ACTOR, ...body }),
    "Recommendation rejected",
  );
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length >= 3) reject.mutate({ reason: reason.trim() }, { onSuccess: onClose });
  };
  return (
    <Modal
      description="Nothing is sent to PayPal. You can re-run triage afterwards for a fresh recommendation."
      onOpenChange={(o) => (o ? null : onClose())}
      open={open}
      title="Reject this recommendation?"
    >
      <form className="grid gap-4" onSubmit={submit}>
        <Field
          error={reject.error?.message}
          hint="Recorded with your name in the case timeline."
          htmlFor="reject-reason"
          label="Reason (required)"
        >
          <Textarea
            autoFocus
            id="reject-reason"
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            required
            value={reason}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="ghost">
            Cancel
          </Button>
          <Button disabled={reason.trim().length < 3 || reject.isPending} type="submit" variant="primary">
            Reject
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Override: pick a different option. A reason is required; the note is regenerated unless given. */
export function OverrideDialog({ open, onClose, decision, value }: DialogProps) {
  const allowed = decision.analysis?.allowed ?? ["FIGHT", "OFFER", "ACCEPT"];
  const choices = allowed.filter((o) => o !== decision.option);
  const [option, setOption] = useState(choices[0] ?? "ACCEPT");
  const [amount, setAmount] = useState("");
  const [offerType, setOfferType] = useState<(typeof OFFER_TYPES)[number]>("REFUND");
  const [reason, setReason] = useState("");
  const override = useDecisionMutation(
    value,
    (body: object) =>
      apiSend("POST", `decisions/${encodeURIComponent(decision.id)}/override`, { by: ACTOR, ...body }),
    "Recommendation overridden",
  );
  useEffect(() => {
    if (!open) return;
    setOption(choices[0] ?? "ACCEPT");
    const suggested = decision.analysis?.ev.offer?.amountCents ?? Math.round(value.amountCents / 2);
    setAmount(fromMinor(suggested, value.currency));
    setOfferType((decision.analysis?.ev.offer?.type as (typeof OFFER_TYPES)[number] | undefined) ?? "REFUND");
    setReason("");
  }, [open]);
  const cents = toMinor(amount, value.currency);
  const amountError =
    option === "OFFER" && (cents == null || cents > value.amountCents)
      ? `Enter an amount up to ${formatMoney(value.amountCents, value.currency)}`
      : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (amountError || reason.trim().length < 3) return;
    override.mutate(
      {
        option,
        reason: reason.trim(),
        ...(option === "OFFER" ? { offerAmountCents: cents, offerType } : {}),
      },
      { onSuccess: onClose },
    );
  };
  return (
    <Modal
      description={`Rebuttal recommended ${decision.option}. Choose another option; the change and your reason are recorded.`}
      onOpenChange={(o) => (o ? null : onClose())}
      open={open}
      title="Override the recommendation"
    >
      <form className="grid gap-4" onSubmit={submit}>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-xs font-semibold text-foreground-strong">Instead</legend>
          {choices.map((o) => (
            <label
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-3 rounded-[6px] border px-3 text-sm",
                option === o ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-subdued",
              )}
              key={o}
            >
              <input
                checked={option === o}
                name="option"
                onChange={() => setOption(o)}
                type="radio"
                value={o}
              />
              <span className="font-semibold text-foreground-strong">{o}</span>
              <span className="text-muted">
                {o === "FIGHT"
                  ? "Submit evidence"
                  : o === "OFFER"
                    ? "Offer a partial refund"
                    : "Refund in full"}
              </span>
            </label>
          ))}
        </fieldset>
        {option === "OFFER" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field error={amountError} htmlFor="override-amount" label={`Offer amount (${value.currency})`}>
              <Input
                id="override-amount"
                inputMode="decimal"
                onChange={(e) => setAmount(e.target.value)}
                value={amount}
              />
            </Field>
            <Field htmlFor="override-type" label="Offer type">
              <Select
                id="override-type"
                onChange={(e) => setOfferType(e.target.value as typeof offerType)}
                value={offerType}
              >
                {OFFER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {offerTypeLabel(t)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : null}
        <Field
          error={override.error?.message}
          hint="Recorded in the case timeline."
          htmlFor="override-reason"
          label="Reason (required)"
        >
          <Textarea
            id="override-reason"
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            required
            value={reason}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={!!amountError || reason.trim().length < 3 || override.isPending}
            type="submit"
            variant="primary"
          >
            Override
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Edit: the cited statement for FIGHT (rebuilds the PDF), the offer for OFFER, the note for ACCEPT. */
export function EditDialog(props: DialogProps) {
  return props.decision.option === "FIGHT" ? <NarrativeEditor {...props} /> : <TermsEditor {...props} />;
}

function NarrativeEditor({ open, onClose, decision, value }: DialogProps) {
  const exhibits =
    decision.analysis?.exhibits.map((x) => ({ id: x.exhibitId, title: x.title, summary: x.summary })) ?? [];
  const [headline, setHeadline] = useState("");
  const [claims, setClaims] = useState<NarrativeClaim[]>([]);
  const save = useDecisionMutation(
    value,
    (body: object) =>
      apiSend("PUT", `decisions/${encodeURIComponent(decision.id)}/narrative`, { by: ACTOR, ...body }),
    "Statement saved. Regenerating the PDF…",
  );
  useEffect(() => {
    if (!open) return;
    const n = decision.narrative;
    setHeadline(n?.headline ?? "We dispute this claim.");
    setClaims(
      n?.claims.length
        ? n.claims.map((c) => ({ ...c }))
        : exhibits.slice(0, 4).map((x) => ({ text: x.summary, exhibits: [x.id] })),
    );
  }, [open]);
  const invalid =
    !headline.trim() || claims.some((c) => !c.text.trim() || c.exhibits.length === 0) || claims.length === 0;
  const update = (i: number, patch: Partial<NarrativeClaim>) =>
    setClaims((all) => all.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const toggle = (i: number, id: string) =>
    update(i, {
      exhibits: claims[i]!.exhibits.includes(id)
        ? claims[i]!.exhibits.filter((x) => x !== id)
        : [...claims[i]!.exhibits, id],
    });
  return (
    <Modal
      description="Every statement must cite at least one exhibit. Saving rewrites the note PayPal receives and regenerates the PDF."
      footer={
        <>
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={invalid || save.isPending}
            onClick={() => save.mutate({ headline: headline.trim(), claims }, { onSuccess: onClose })}
            variant="primary"
          >
            {save.isPending ? "Saving…" : "Save and regenerate PDF"}
          </Button>
        </>
      }
      onOpenChange={(o) => (o ? null : onClose())}
      open={open}
      title="Edit the seller statement"
      wide
    >
      <div className="grid gap-5">
        <Field htmlFor="narrative-headline" label="Headline">
          <Input
            id="narrative-headline"
            maxLength={200}
            onChange={(e) => setHeadline(e.target.value)}
            value={headline}
          />
        </Field>
        <ol className="grid gap-4">
          {claims.map((claim, i) => (
            <li className="rounded-[6px] border border-border p-3" key={i}>
              <div className="flex items-start gap-2">
                <span className="mono mt-2.5 text-xs text-muted">{i + 1}.</span>
                <Textarea
                  aria-label={`Statement ${i + 1}`}
                  className="min-h-16"
                  maxLength={600}
                  onChange={(e) => update(i, { text: e.target.value })}
                  value={claim.text}
                />
                <Button
                  aria-label={`Remove statement ${i + 1}`}
                  disabled={claims.length === 1}
                  onClick={() => setClaims((all) => all.filter((_, j) => j !== i))}
                  variant="ghost"
                >
                  <Cross2Icon aria-hidden />
                </Button>
              </div>
              <div aria-label="Cited exhibits" className="mt-2 flex flex-wrap gap-1.5 pl-5" role="group">
                {exhibits.map((x) => {
                  const on = claim.exhibits.includes(x.id);
                  return (
                    <button
                      aria-pressed={on}
                      className={cn(
                        "mono min-h-8 rounded-full border px-2.5 text-[11px] font-semibold transition-colors",
                        on
                          ? "border-accent bg-accent-soft text-accent-strong"
                          : "border-border text-muted hover:border-border-strong",
                      )}
                      key={x.id}
                      onClick={() => toggle(i, x.id)}
                      title={x.summary}
                      type="button"
                    >
                      {x.id} · {x.title.slice(0, 28)}
                    </button>
                  );
                })}
              </div>
              {claim.exhibits.length === 0 ? (
                <p className="mt-1 pl-5 text-xs text-danger">Cite at least one exhibit.</p>
              ) : null}
            </li>
          ))}
        </ol>
        <div>
          <Button
            disabled={claims.length >= 12}
            onClick={() =>
              setClaims((all) => [...all, { text: "", exhibits: exhibits[0] ? [exhibits[0].id] : [] }])
            }
            size="compact"
          >
            <PlusIcon aria-hidden /> Add statement
          </Button>
        </div>
        {save.error ? (
          <p className="text-sm text-danger" role="alert">
            {save.error.message}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function TermsEditor({ open, onClose, decision, value }: DialogProps) {
  const isOffer = decision.option === "OFFER";
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const save = useDecisionMutation(
    value,
    (body: object) =>
      apiSend("PATCH", `decisions/${encodeURIComponent(decision.id)}`, { editedBy: ACTOR, ...body }),
    "Decision updated",
  );
  useEffect(() => {
    if (!open) return;
    setAmount(fromMinor(decision.offerAmountCents, value.currency));
    setNote(decision.note);
  }, [open]);
  const cents = toMinor(amount, value.currency);
  const amountError =
    isOffer && (cents == null || cents > value.amountCents)
      ? `Enter an amount up to ${formatMoney(value.amountCents, value.currency)}`
      : null;
  const amountChanged = isOffer && cents !== decision.offerAmountCents;
  const noteChanged = note.trim() !== decision.note;
  return (
    <Modal
      description={
        isOffer
          ? "Change the amount; the note is rewritten to match unless you edit it too."
          : "Edit the note PayPal receives."
      }
      footer={
        <>
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={!!amountError || (!amountChanged && !noteChanged) || !note.trim() || save.isPending}
            onClick={() =>
              save.mutate(
                {
                  ...(amountChanged ? { offerAmountCents: cents } : {}),
                  ...(noteChanged ? { note: note.trim() } : {}),
                },
                { onSuccess: onClose },
              )
            }
            variant="primary"
          >
            Save
          </Button>
        </>
      }
      onOpenChange={(o) => (o ? null : onClose())}
      open={open}
      title={isOffer ? "Edit the offer" : "Edit the note"}
    >
      <div className="grid gap-4">
        {isOffer ? (
          <Field
            error={amountError}
            hint={offerTypeLabel(decision.offerType)}
            htmlFor="edit-amount"
            label={`Offer amount (${value.currency})`}
          >
            <Input
              id="edit-amount"
              inputMode="decimal"
              onChange={(e) => setAmount(e.target.value)}
              value={amount}
            />
          </Field>
        ) : null}
        <Field error={save.error?.message} htmlFor="edit-note" label="Note to PayPal">
          <Textarea
            className="min-h-32"
            id="edit-note"
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
            value={note}
          />
        </Field>
      </div>
    </Modal>
  );
}
