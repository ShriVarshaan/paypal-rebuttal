"use client";

import {
  DownloadIcon,
  ExclamationTriangleIcon,
  EyeOpenIcon,
  FileTextIcon,
  ReloadIcon,
} from "@radix-ui/react-icons";
import type { CaseDetail, DecisionRecord } from "@rebuttal/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";
import { apiSend } from "@/lib/api";
import { bytes, evidenceTypeLabel, relativeTime } from "@/lib/format";

export const packFileUrl = (packId: string, name = "preview") =>
  `/api/rebuttal/packs/${encodeURIComponent(packId)}/file${name === "preview" ? "" : `?name=${encodeURIComponent(name)}`}`;

/** The PDF evidence pack for a FIGHT decision: build state, preview and the submission files. */
export function PackCard({ value, decision }: { value: CaseDetail; decision: DecisionRecord }) {
  const pack = value.pack && value.pack.decisionId === decision.id ? value.pack : null;
  const [preview, setPreview] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();
  const rebuild = useMutation({
    mutationFn: () => apiSend("POST", `decisions/${encodeURIComponent(decision.id)}/pack`),
    onSuccess: () => {
      toast({ tone: "info", title: "Rebuilding the evidence PDF" });
      void queryClient.invalidateQueries({ queryKey: ["case", value.id] });
    },
    onError: (e) => toast({ tone: "danger", title: "Could not rebuild the PDF", body: e.message }),
  });
  const canRebuild =
    decision.status === "PROPOSED" || decision.status === "APPROVED" || decision.status === "AUTO_APPROVED";
  const building = !pack || pack.status === "PENDING";

  return (
    <div className="rounded-[6px] border border-border bg-surface-subdued p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileTextIcon aria-hidden className="text-muted" />
          <p className="text-xs font-semibold text-foreground-strong">Evidence pack (PDF)</p>
        </div>
        {pack?.status === "READY" ? (
          <Badge tone="success">Ready</Badge>
        ) : pack?.status === "FAILED" ? (
          <Badge tone="danger">Failed</Badge>
        ) : (
          <Badge tone="accent">Building</Badge>
        )}
      </div>

      {building ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted" role="status">
          <span
            aria-hidden
            className="size-3.5 animate-spin rounded-full border-2 border-border border-t-accent motion-reduce:animate-none"
          />
          {pack ? "Regenerating the cover letter and exhibits…" : "Waiting for the PDF to be built…"}
        </div>
      ) : null}

      {pack?.status === "FAILED" ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {pack.error ?? "The PDF could not be built."} Rebuttal still files the evidence without the PDF two
          hours before the deadline.
        </p>
      ) : null}

      {pack?.status === "READY" ? (
        <>
          <p className="mt-3 text-sm text-foreground">
            {pack.exhibits.length} exhibit{pack.exhibits.length === 1 ? "" : "s"} · {pack.files.length} file
            {pack.files.length === 1 ? "" : "s"} · {bytes(pack.totalBytes ?? 0)} · built{" "}
            {relativeTime(pack.updatedAt)}
          </p>
          <ul className="mt-3 divide-y divide-border rounded-[6px] border border-border bg-surface text-sm">
            {pack.files.map((f) => (
              <li className="flex items-center gap-3 px-3 py-2" key={f.name}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground-strong">
                    {evidenceTypeLabel(f.evidenceType)}
                  </p>
                  <p className="mono truncate text-[11px] text-muted">
                    {f.exhibits.join(", ") || "Cover letter"} · {f.pages ?? "?"} pp · {bytes(f.sizeBytes)}
                  </p>
                </div>
                <a
                  aria-label={`Open ${f.name}`}
                  className="grid size-9 place-items-center rounded-[6px] text-muted hover:bg-surface-subdued hover:text-foreground-strong"
                  href={packFileUrl(pack.id, f.name)}
                  rel="noreferrer"
                  target="_blank"
                >
                  <DownloadIcon aria-hidden />
                </a>
              </li>
            ))}
          </ul>
          {pack.warnings.length ? (
            <ul className="mt-3 space-y-1 text-xs text-warning">
              {pack.warnings.map((w) => (
                <li className="flex gap-1.5" key={w}>
                  <ExclamationTriangleIcon aria-hidden className="mt-0.5 shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {pack?.status === "READY" && pack.hasPreview ? (
          <Button onClick={() => setPreview(true)} size="compact" variant="primary">
            <EyeOpenIcon aria-hidden /> Preview PDF
          </Button>
        ) : null}
        {canRebuild && !building ? (
          <Button disabled={rebuild.isPending} onClick={() => rebuild.mutate()} size="compact">
            <ReloadIcon aria-hidden /> Rebuild
          </Button>
        ) : null}
      </div>

      {pack?.status === "READY" ? (
        <Modal
          description={`Exactly what PayPal's reviewer will receive for ${value.paypalDisputeId}: the cover letter, then each exhibit.`}
          footer={
            <a
              className="inline-flex min-h-11 items-center gap-2 rounded-[6px] border border-border-strong bg-surface px-4 text-sm font-semibold hover:bg-surface-subdued"
              href={packFileUrl(pack.id)}
              rel="noreferrer"
              target="_blank"
            >
              <DownloadIcon aria-hidden /> Open in a new tab
            </a>
          }
          onOpenChange={setPreview}
          open={preview}
          title="Evidence pack preview"
          wide
        >
          <iframe
            className="h-[70dvh] w-full rounded-[6px] border border-border bg-white"
            src={packFileUrl(pack.id)}
            title="Evidence pack PDF"
          />
        </Modal>
      ) : null}
    </div>
  );
}
