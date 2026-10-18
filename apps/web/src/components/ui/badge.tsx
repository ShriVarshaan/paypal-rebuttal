import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type BadgeTone = "neutral" | "accent" | "danger" | "warning" | "success";

const toneClass: Record<BadgeTone, string> = {
  neutral: "border-border bg-surface-subdued text-muted",
  accent: "border-accent/20 bg-accent-soft text-accent-strong",
  danger: "border-danger/20 bg-danger-soft text-danger",
  warning: "border-warning/20 bg-warning-soft text-warning",
  success: "border-success/20 bg-success-soft text-success",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase leading-none tracking-[0.055em]",
        toneClass[tone],
        className,
      )}
      {...props}
    />
  );
}
