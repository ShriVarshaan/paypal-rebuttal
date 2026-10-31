"use client";

import {
  BellIcon,
  ChatBubbleIcon,
  CheckCircledIcon,
  ClockIcon,
  CrossCircledIcon,
  ExclamationTriangleIcon,
  FileTextIcon,
  LightningBoltIcon,
  MagnifyingGlassIcon,
  Pencil1Icon,
  PaperPlaneIcon,
  PersonIcon,
  ReaderIcon,
  UpdateIcon,
} from "@radix-ui/react-icons";
import type { CaseDetail } from "@rebuttal/core";
import type { ComponentType } from "react";
import { bytes, dateTime, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type Actor = "buyer" | "seller" | "paypal" | "rebuttal";
interface Entry {
  key: string;
  at: string | null;
  actor: Actor;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  body?: string | null;
  tone?: "danger" | "success" | "warning";
  meta?: string | null;
}

const ACTOR_LABEL: Record<Actor, string> = {
  buyer: "Buyer",
  seller: "You",
  paypal: "PayPal",
  rebuttal: "Rebuttal",
};
const p = (payload: unknown) =>
  typeof payload === "object" && payload ? (payload as Record<string, unknown>) : {};
const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const words = (v: unknown) => s(v).replaceAll("_", " ").toLowerCase();

/** One readable line per CaseEvent type. Unknown types still render, never as raw JSON. */
function describe(type: string, raw: unknown, value: CaseDetail): Omit<Entry, "key" | "at"> {
  const x = p(raw);
  switch (type) {
    case "CREATED":
      return {
        actor: "paypal",
        icon: BellIcon,
        title: "Dispute opened",
        body: `${words(x["reason"])} · ${words(x["stage"])}`,
      };
    case "STATUS_CHANGED":
      return {
        actor: "paypal",
        icon: UpdateIcon,
        title: `Status: ${words(x["to"])}`,
        meta: `was ${words(x["from"])}`,
      };
    case "STAGE_CHANGED":
      return { actor: "paypal", icon: UpdateIcon, title: `Escalated to ${words(x["to"])}`, tone: "warning" };
    case "DUE_DATE_CHANGED":
      return {
        actor: "paypal",
        icon: ClockIcon,
        title: "Response deadline changed",
        body: x["to"] ? `Now due ${dateTime(s(x["to"]))}` : "Deadline removed",
      };
    case "BUYER_MESSAGE":
      return { actor: "buyer", icon: ChatBubbleIcon, title: "New message from the buyer" };
    case "OUTCOME": {
      const code = s(x["outcomeCode"]);
      const won = /SELLER|CANCELED_BY_BUYER/.test(code);
      return {
        actor: "paypal",
        icon: won ? CheckCircledIcon : CrossCircledIcon,
        title: won ? "Resolved in your favour" : "Resolved",
        body: words(code),
        tone: won ? "success" : "danger",
      };
    }
    case "ENRICHED":
      return { actor: "rebuttal", icon: MagnifyingGlassIcon, title: "Matched the PayPal payment and order" };
    case "EVIDENCE_GATHERED": {
      const sources = p(x["sources"]);
      const n = Object.values(sources).reduce<number>((a, v) => a + (typeof v === "number" ? v : 0), 0);
      const failures = Array.isArray(x["failures"]) ? (x["failures"] as string[]) : [];
      return {
        actor: "rebuttal",
        icon: ReaderIcon,
        title: `Gathered ${n} evidence record${n === 1 ? "" : "s"}`,
        body: Object.keys(sources).length ? `From ${Object.keys(sources).join(", ")}` : null,
        ...(failures.length
          ? { tone: "warning" as const, meta: `${failures.length} source(s) failed: ${failures.join("; ")}` }
          : {}),
      };
    }
    case "TRIAGED":
      return {
        actor: "rebuttal",
        icon: LightningBoltIcon,
        title: `Recommended ${s(x["option"])}`,
        body:
          typeof x["pWin"] === "number"
            ? `p(win) ${(x["pWin"] * 100).toFixed(0)}% · evidence ${Math.round(Number(x["completeness"] ?? 0) * 100)}%`
            : null,
        ...(Array.isArray(x["injection"]) && x["injection"].length
          ? {
              tone: "warning" as const,
              meta: "Buyer text looked like an instruction to the assistant; it was ignored.",
            }
          : {}),
      };
    case "DECISION_PROPOSED":
      return {
        actor: "rebuttal",
        icon: LightningBoltIcon,
        title: x["autoApproved"] ? "Auto-approved by your policy" : "Waiting for your approval",
        body: Array.isArray(x["reasons"]) ? (x["reasons"] as string[]).join("; ") : null,
      };
    case "DECISION_SUPERSEDED":
      return { actor: "rebuttal", icon: UpdateIcon, title: "Earlier recommendation replaced" };
    case "DECISION_EDITED": {
      const to = p(x["to"]);
      return {
        actor: "seller",
        icon: Pencil1Icon,
        title: x["override"] ? `Changed the decision to ${s(to["option"])}` : "Edited the decision",
        body:
          typeof to["offerAmountCents"] === "number"
            ? `Offer ${formatMoney(to["offerAmountCents"], value.currency)}`
            : null,
        meta: x["editedBy"] ? `by ${s(x["editedBy"])}` : null,
      };
    }
    case "DECISION_OVERRIDDEN":
      return {
        actor: "seller",
        icon: UpdateIcon,
        title: `Overrode ${s(x["from"])} → ${s(x["to"])}`,
        body: `Reason: ${s(x["reason"])}`,
        meta: `by ${s(x["by"])}`,
      };
    case "DECISION_APPROVED":
      return {
        actor: "seller",
        icon: CheckCircledIcon,
        title: `Approved ${s(x["option"])}`,
        meta: `by ${s(x["by"])}`,
        tone: "success",
      };
    case "DECISION_REJECTED":
      return {
        actor: "seller",
        icon: CrossCircledIcon,
        title: `Rejected ${s(x["option"])}`,
        body: `Reason: ${s(x["reason"])}`,
        meta: `by ${s(x["by"])}`,
      };
    case "NARRATIVE_EDITED":
      return {
        actor: "seller",
        icon: Pencil1Icon,
        title: "Edited the seller statement",
        body: `${s(x["claims"])} cited statement(s)`,
      };
    case "PACK_READY":
      return {
        actor: "rebuttal",
        icon: FileTextIcon,
        title: "Evidence PDF ready",
        body: `${s(x["pages"])} pages in ${s(x["files"])} file(s) · ${bytes(Number(x["totalBytes"] ?? 0))}`,
      };
    case "PACK_FAILED":
      return {
        actor: "rebuttal",
        icon: ExclamationTriangleIcon,
        title: "Evidence PDF failed",
        body: s(x["error"]),
        tone: "danger",
      };
    case "DECISION_EXECUTING":
      return {
        actor: "rebuttal",
        icon: PaperPlaneIcon,
        title: x["waitingFor"]
          ? "Approved; waiting for the evidence PDF"
          : `Filing ${words(x["kind"])} with PayPal`,
      };
    case "ACTION_SUCCEEDED":
      return {
        actor: "rebuttal",
        icon: CheckCircledIcon,
        title: `PayPal accepted ${words(x["kind"])}`,
        tone: "success",
      };
    case "ACTION_FAILED": {
      const err = p(x["error"]);
      return {
        actor: "rebuttal",
        icon: ExclamationTriangleIcon,
        title: `PayPal rejected ${words(x["kind"])}`,
        body: s(err["message"]),
        meta: err["debugId"] ? `debug_id ${s(err["debugId"])}` : null,
        tone: "danger",
      };
    }
    case "MESSAGE_SENT":
      return {
        actor: "seller",
        icon: PaperPlaneIcon,
        title: "Message sent to the buyer",
        body: s(x["message"]),
      };
    case "SLA_REMINDER":
      return {
        actor: "rebuttal",
        icon: ClockIcon,
        title: `Deadline reminder: ${s(x["hoursLeft"])}h left`,
        tone: "warning",
      };
    case "SLA_FORCED_DECISION":
      return {
        actor: "rebuttal",
        icon: LightningBoltIcon,
        title: "Deadline near: filed the safe default",
        tone: "warning",
      };
    case "APPEAL_DRAFTED":
      return {
        actor: "rebuttal",
        icon: FileTextIcon,
        title: "Appeal drafted",
        body: x["recommendAppeal"] === false ? "Appeal not recommended" : null,
      };
    default:
      return { actor: "rebuttal", icon: BellIcon, title: words(type) };
  }
}

const actorFor = (postedBy: string): Actor =>
  postedBy === "BUYER" ? "buyer" : postedBy === "SELLER" ? "seller" : "paypal";

export function buildTimeline(value: CaseDetail): Entry[] {
  const seen = new Set<string>();
  // Messages sent from Rebuttal show once, as MESSAGE_SENT, even after PayPal echoes them back.
  const sentFromHere = new Set(
    value.events.filter((e) => e.type === "MESSAGE_SENT").map((e) => s(p(e.payload)["message"]).trim()),
  );
  const messages: Entry[] = value.messages.flatMap((m, i) => {
    const key = `${m.postedBy}|${m.postedAt}|${m.content}`;
    if (seen.has(key) || (m.postedBy === "SELLER" && sentFromHere.has(m.content.trim()))) return [];
    seen.add(key);
    return [
      {
        key: `m-${i}`,
        at: m.postedAt,
        actor: actorFor(m.postedBy),
        icon: m.postedBy === "SELLER" ? PersonIcon : ChatBubbleIcon,
        title:
          m.postedBy === "SELLER" ? "You wrote" : m.postedBy === "BUYER" ? "Buyer wrote" : "PayPal wrote",
        body: m.content,
      },
    ];
  });
  const events: Entry[] = value.events.map((e) => ({
    key: `e-${e.id}`,
    at: typeof e.createdAt === "string" ? e.createdAt : null,
    ...describe(e.type, e.payload, value),
  }));
  // Actions add PayPal's debug_id even when an event was not written (e.g. a retrying attempt).
  const actions: Entry[] = value.actions
    .filter(
      (a) =>
        a.status === "FAILED" &&
        !value.events.some((e) => e.type === "ACTION_FAILED" && p(e.payload)["actionId"] === a.id),
    )
    .map((a) => ({
      key: `a-${a.id}`,
      at: a.completedAt ?? a.createdAt,
      actor: "rebuttal",
      icon: ExclamationTriangleIcon,
      title: `PayPal rejected ${words(a.kind)}`,
      body: a.errorMessage,
      meta: a.debugId ? `debug_id ${a.debugId}` : null,
      tone: "danger",
    }));
  return [...messages, ...events, ...actions].sort((l, r) => {
    if (!l.at && r.at) return 1;
    if (l.at && !r.at) return -1;
    return (l.at ? Date.parse(l.at) : 0) - (r.at ? Date.parse(r.at) : 0);
  });
}

export function CaseTimeline({ value }: { value: CaseDetail }) {
  const entries = buildTimeline(value);
  if (!entries.length) return <p className="text-sm text-muted">No timeline events have been recorded.</p>;
  return (
    <ol className="relative space-y-5 before:absolute before:inset-y-1 before:left-[13px] before:w-px before:bg-border">
      {entries.map(({ key, at, actor, icon: Icon, title, body, meta, tone }) => (
        <li className="relative flex gap-3" key={key}>
          <span
            className={cn(
              "z-[1] grid size-7 shrink-0 place-items-center rounded-full border bg-surface",
              tone === "danger" && "border-danger/30 text-danger",
              tone === "success" && "border-success/30 text-success",
              tone === "warning" && "border-warning/30 text-warning",
              !tone &&
                (actor === "rebuttal" ? "border-accent/25 text-accent-strong" : "border-border text-muted"),
            )}
          >
            <Icon aria-hidden className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-sm font-semibold text-foreground-strong">{title}</p>
            <p className="mono mt-0.5 text-[11px] text-muted">
              {ACTOR_LABEL[actor]} · {at ? dateTime(at) : "Undated"}
            </p>
            {body ? (
              <p
                className={cn(
                  "mt-1.5 whitespace-pre-wrap break-words text-sm leading-6",
                  actor === "buyer" || actor === "seller"
                    ? "rounded-[6px] bg-surface-subdued px-3 py-2"
                    : "text-foreground",
                )}
              >
                {body}
              </p>
            ) : null}
            {meta ? <p className="mono mt-1 text-[11px] text-muted">{meta}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
