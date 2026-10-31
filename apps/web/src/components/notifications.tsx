"use client";

import * as Popover from "@radix-ui/react-dialog";
import { BellIcon, CheckIcon, ExclamationTriangleIcon, InfoCircledIcon } from "@radix-ui/react-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { apiGet, apiSend } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const Notification = z.object({
  id: z.string(),
  caseId: z.string().nullable(),
  kind: z.string(),
  level: z.string(),
  message: z.string(),
  createdAt: z.string(),
});

/** The bell: unread SLA reminders, approvals and failures. The event stream refreshes it. */
export function NotificationsBell() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiGet("notifications", Notification.array()),
    refetchInterval: 60_000,
  });
  const markRead = useMutation({
    mutationFn: (id: string | null) =>
      apiSend("POST", id ? `notifications/${encodeURIComponent(id)}/read` : "notifications/read-all"),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const items = query.data ?? [];
  const critical = items.some((n) => n.level === "critical");

  return (
    <Popover.Root modal={false}>
      <Popover.Trigger asChild>
        <Button
          aria-label={`Notifications${items.length ? `, ${items.length} unread` : ""}`}
          className="relative"
          variant="icon"
        >
          <BellIcon aria-hidden />
          {items.length ? (
            <span
              className={cn(
                "mono absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full px-1 text-[10px] font-bold leading-5",
                critical ? "bg-danger text-white" : "bg-accent text-accent-foreground",
              )}
            >
              {items.length > 9 ? "9+" : items.length}
            </span>
          ) : null}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-describedby={undefined}
          className="surface-shadow fixed right-4 top-16 z-50 w-[min(380px,calc(100vw-32px))] rounded-[8px] border border-border bg-surface outline-none"
          onInteractOutside={(e) => {
            if ((e.target as Element | null)?.closest("[aria-label^='Notifications']")) e.preventDefault();
          }}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <Popover.Title className="text-sm font-semibold text-foreground-strong">
              Notifications
            </Popover.Title>
            {items.length ? (
              <Button
                disabled={markRead.isPending}
                onClick={() => markRead.mutate(null)}
                size="compact"
                variant="ghost"
              >
                <CheckIcon aria-hidden /> Mark all read
              </Button>
            ) : null}
          </div>
          {query.error ? (
            <p className="p-4 text-sm text-danger">Could not load notifications: {query.error.message}</p>
          ) : items.length === 0 ? (
            <p className="p-4 text-sm leading-6 text-muted">
              You&apos;re all caught up. Deadline reminders and approvals appear here.
            </p>
          ) : (
            <ul className="max-h-[60dvh] divide-y divide-border overflow-y-auto">
              {items.map((n) => {
                const Icon = n.level === "info" ? InfoCircledIcon : ExclamationTriangleIcon;
                const body = (
                  <>
                    <Icon
                      aria-hidden
                      className={cn(
                        "mt-0.5 shrink-0",
                        n.level === "critical"
                          ? "text-danger"
                          : n.level === "warning"
                            ? "text-warning"
                            : "text-accent-strong",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm leading-5 text-foreground-strong">{n.message}</span>
                      <span className="mono mt-0.5 block text-[11px] text-muted">
                        {n.kind.replaceAll("_", " ").toLowerCase()} · {relativeTime(n.createdAt)}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li className="flex items-start gap-2 px-4 py-3" key={n.id}>
                    {n.caseId ? (
                      <Popover.Close asChild>
                        <Link
                          className="flex min-w-0 flex-1 items-start gap-2.5 outline-none focus-visible:underline"
                          href={`/cases/${n.caseId}`}
                          onClick={() => markRead.mutate(n.id)}
                        >
                          {body}
                        </Link>
                      </Popover.Close>
                    ) : (
                      <span className="flex min-w-0 flex-1 items-start gap-2.5">{body}</span>
                    )}
                    <button
                      aria-label="Mark as read"
                      className="grid size-7 shrink-0 place-items-center rounded-[4px] text-muted hover:bg-surface-subdued"
                      onClick={() => markRead.mutate(n.id)}
                      type="button"
                    >
                      <CheckIcon aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
