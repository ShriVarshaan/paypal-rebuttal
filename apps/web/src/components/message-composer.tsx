"use client";

import { MagicWandIcon, PaperPlaneIcon } from "@radix-ui/react-icons";
import { BuyerMessageDraft, type CaseDetail } from "@rebuttal/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { Eyebrow, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toaster";
import { apiSend } from "@/lib/api";

const newRequestId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Buyer message composer (Day 12): Rebuttal drafts a calm, de-escalating message for the
 * current recommendation, the seller edits it, and sending goes through PayPal's
 * send-message endpoint as a recorded, idempotent Action.
 */
export function MessageComposer({ value }: { value: CaseDetail }) {
  const [text, setText] = useState("");
  const [source, setSource] = useState<"claude" | "template" | null>(null);
  const [requestId, setRequestId] = useState(newRequestId);
  const [confirm, setConfirm] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();
  const resolved = value.status === "RESOLVED";
  const inFlight = value.actions.some(
    (a) => a.kind === "SEND_MESSAGE" && (a.status === "PENDING" || a.status === "IN_FLIGHT"),
  );

  const draft = useMutation({
    mutationFn: async () =>
      BuyerMessageDraft.parse(await apiSend("POST", `cases/${encodeURIComponent(value.id)}/buyer-message`)),
    onSuccess: (d) => {
      setText(d.message);
      setSource(d.source);
    },
    onError: (e) => toast({ tone: "danger", title: "Could not draft a message", body: e.message }),
  });
  const send = useMutation({
    mutationFn: () =>
      apiSend("POST", `cases/${encodeURIComponent(value.id)}/messages`, {
        message: text.trim(),
        requestId,
        by: "seller",
      }),
    onSuccess: () => {
      toast({
        tone: "success",
        title: "Message queued",
        body: "It appears in the timeline once PayPal accepts it.",
      });
      setText("");
      setSource(null);
      setRequestId(newRequestId());
      setConfirm(false);
      void queryClient.invalidateQueries({ queryKey: ["case", value.id] });
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <Eyebrow tone="muted">Message the buyer</Eyebrow>
        {source ? <Badge>{source === "claude" ? "Drafted by Claude" : "Template draft"}</Badge> : null}
      </div>
      {resolved ? (
        <p className="mt-2 text-sm text-muted">The dispute is resolved; PayPal no longer accepts messages.</p>
      ) : (
        <>
          <Textarea
            aria-label="Message to the buyer"
            className="mt-2"
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write to the buyer, or let Rebuttal draft a message for the current recommendation."
            value={text}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="mono text-[11px] text-muted">{text.length}/2000</span>
            <div className="flex gap-2">
              <Button disabled={draft.isPending} onClick={() => draft.mutate()} size="compact">
                <MagicWandIcon aria-hidden />{" "}
                {draft.isPending ? "Drafting…" : text ? "Redraft" : "Draft for me"}
              </Button>
              <Button
                disabled={!text.trim() || send.isPending || inFlight}
                onClick={() => setConfirm(true)}
                size="compact"
                variant="primary"
              >
                <PaperPlaneIcon aria-hidden /> Send
              </Button>
            </div>
          </div>
          {inFlight ? (
            <p className="mt-2 text-xs text-muted" role="status">
              Sending your last message through PayPal…
            </p>
          ) : null}
        </>
      )}
      <Modal
        description={`This sends your message to the buyer through PayPal for dispute ${value.paypalDisputeId}. It cannot be unsent.`}
        footer={
          <>
            <Button onClick={() => setConfirm(false)} variant="ghost">
              Cancel
            </Button>
            <Button disabled={send.isPending} onClick={() => send.mutate()} variant="primary">
              {send.isPending ? "Sending…" : "Send message"}
            </Button>
          </>
        }
        onOpenChange={setConfirm}
        open={confirm}
        title="Send this message?"
      >
        <p className="whitespace-pre-wrap rounded-[6px] border border-border bg-surface-subdued p-3 text-sm leading-6">
          {text}
        </p>
        {send.error ? (
          <p className="mt-2 text-sm text-danger" role="alert">
            {send.error.message}
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
