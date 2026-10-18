import { cn } from "@/lib/utils";

export interface ProgressProps {
  value: number;
  className?: string;
  label?: string;
}

export function Progress({ value, className, label = "Evidence completeness" }: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={clamped}
      className={cn("h-1.5 overflow-hidden rounded-full bg-border", className)}
      role="progressbar"
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-200"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
