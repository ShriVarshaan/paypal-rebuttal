"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useToast } from "@/components/ui/toaster";
import { formatMoney } from "@/lib/format";

type Status = "connecting" | "live" | "offline";
const LiveContext = createContext<Status>("connecting");
export const useLiveStatus = () => useContext(LiveContext);

interface CaseEventMessage {
  caseId: string;
  type: string;
  case: {
    paypalDisputeId: string;
    reason: string;
    amountCents: number;
    currency: string;
    sellerResponseDueAt: string | null;
  };
}

const REASON: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  UNAUTHORISED: "Unauthorised",
};

function dueIn(iso: string | null): string {
  if (!iso) return "no deadline";
  const hours = (Date.parse(iso) - Date.now()) / 3_600_000;
  if (hours < 0) return "overdue";
  return hours < 48 ? `due in ${Math.round(hours)}h` : `due in ${Math.round(hours / 24)} days`;
}

/** Events that change what the seller should see or do next get a toast; the rest update quietly. */
const TOASTS: Record<
  string,
  (m: CaseEventMessage) => { title: string; tone: "info" | "success" | "warning" | "danger" }
> = {
  CREATED: (m) => ({
    title: `New dispute: ${formatMoney(m.case.amountCents, m.case.currency)} ${REASON[m.case.reason] ?? m.case.reason.toLowerCase()}, ${dueIn(m.case.sellerResponseDueAt)}`,
    tone: "info",
  }),
  DECISION_PROPOSED: (m) => ({ title: `${m.case.paypalDisputeId}: a recommendation is ready`, tone: "info" }),
  ACTION_SUCCEEDED: (m) => ({
    title: `${m.case.paypalDisputeId}: PayPal accepted the filing`,
    tone: "success",
  }),
  ACTION_FAILED: (m) => ({ title: `${m.case.paypalDisputeId}: PayPal rejected an action`, tone: "danger" }),
  OUTCOME: (m) => ({ title: `${m.case.paypalDisputeId}: PayPal resolved the dispute`, tone: "success" }),
};

/**
 * Subscribes to the api's event stream through the web proxy. Each event refreshes only the
 * queries it affects; EventSource reconnects on its own and resumes from the last event id.
 */
export function LiveUpdates({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<Status>("connecting");

  useEffect(() => {
    const source = new EventSource("/api/rebuttal/events/stream");
    let connectedBefore = false;
    source.addEventListener("ready", () => {
      setStatus("live");
      // After a reconnect, refetch once: the stream resumes from the last event id, and this
      // also covers a resume the browser could not make (e.g. the api restarted).
      if (connectedBefore)
        for (const key of ["cases", "case", "metrics", "notifications"])
          void queryClient.invalidateQueries({ queryKey: [key] });
      connectedBefore = true;
    });
    source.onerror = () => setStatus(source.readyState === EventSource.CLOSED ? "offline" : "connecting");
    source.addEventListener("case", (e) => {
      let m: CaseEventMessage;
      try {
        m = JSON.parse((e as MessageEvent<string>).data) as CaseEventMessage;
      } catch {
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["cases"] });
      void queryClient.invalidateQueries({ queryKey: ["case", m.caseId] });
      void queryClient.invalidateQueries({ queryKey: ["metrics"] });
      const t = TOASTS[m.type]?.(m);
      if (t) toast({ ...t, href: `/cases/${m.caseId}` });
    });
    source.addEventListener("notification", () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    });
    return () => source.close();
  }, [queryClient, toast]);

  return <LiveContext.Provider value={status}>{children}</LiveContext.Provider>;
}
