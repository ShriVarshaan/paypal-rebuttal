"use client";

import {
  CheckCircledIcon,
  Cross2Icon,
  ExclamationTriangleIcon,
  InfoCircledIcon,
} from "@radix-ui/react-icons";
import Link from "next/link";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: "info" | "success" | "warning" | "danger";
  href?: string;
}

const ToastContext = createContext<(t: Omit<Toast, "id">) => void>(() => {});

export const useToast = () => useContext(ToastContext);

const ICONS = {
  info: InfoCircledIcon,
  success: CheckCircledIcon,
  warning: ExclamationTriangleIcon,
  danger: ExclamationTriangleIcon,
};

/** Non-blocking notices in a polite live region; each closes itself after 7 seconds. */
export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = next.current++;
      setToasts((all) => [...all.slice(-3), { ...t, id }]);
      window.setTimeout(() => dismiss(id), 7_000);
    },
    [dismiss],
  );
  const value = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2"
      >
        {toasts.map((t) => {
          const Icon = ICONS[t.tone];
          const content = (
            <>
              <Icon
                aria-hidden
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  t.tone === "success" && "text-success",
                  t.tone === "warning" && "text-warning",
                  t.tone === "danger" && "text-danger",
                  t.tone === "info" && "text-accent-strong",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground-strong">{t.title}</p>
                {t.body ? <p className="mt-0.5 text-xs leading-5 text-muted">{t.body}</p> : null}
              </div>
            </>
          );
          return (
            <div
              className="surface-shadow pointer-events-auto flex items-start gap-3 rounded-[8px] border border-border bg-surface p-3 motion-safe:animate-in motion-safe:slide-in-from-bottom-2"
              key={t.id}
              role="status"
            >
              {t.href ? (
                <Link
                  className="flex min-w-0 flex-1 items-start gap-3 outline-none focus-visible:underline"
                  href={t.href}
                  onClick={() => dismiss(t.id)}
                >
                  {content}
                </Link>
              ) : (
                <div className="flex min-w-0 flex-1 items-start gap-3">{content}</div>
              )}
              <button
                aria-label="Dismiss"
                className="grid size-6 shrink-0 place-items-center rounded-[4px] text-muted hover:bg-surface-subdued"
                onClick={() => dismiss(t.id)}
                type="button"
              >
                <Cross2Icon aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
