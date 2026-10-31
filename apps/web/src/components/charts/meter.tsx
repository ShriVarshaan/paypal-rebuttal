import { percent } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * p(win) meter. The fill carries the value; a tick marks the model's own estimate when Claude's
 * bounded adjustment moved it, so the nudge is visible rather than hidden in the number.
 */
export function WinMeter({
  value,
  model,
  label = "Probability of winning",
}: {
  value: number;
  model?: number | null;
  label?: string;
}) {
  const tone = value >= 0.6 ? "bg-accent" : value >= 0.35 ? "bg-warning" : "bg-danger";
  const shifted = model != null && Math.abs(model - value) >= 0.005;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold text-muted">{label}</span>
        <span className="mono text-2xl font-semibold tracking-[-0.02em] text-foreground-strong">
          {percent(value)}
        </span>
      </div>
      <div
        aria-label={`${label}: ${percent(value)}${shifted ? `, model estimate ${percent(model!)}` : ""}`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(value * 100)}
        className="relative mt-2 h-2.5 rounded-full bg-border"
        role="meter"
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-200", tone)}
          style={{ width: `${value * 100}%` }}
        />
        {shifted ? (
          <span
            aria-hidden
            className="absolute -top-1 h-[18px] w-[2px] rounded-full bg-foreground-strong"
            style={{ left: `calc(${model! * 100}% - 1px)` }}
            title={`Model estimate ${percent(model!)}`}
          />
        ) : null}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted">
        <span>0%</span>
        {shifted ? <span>Tick: model before adjustment ({percent(model!)})</span> : null}
        <span>100%</span>
      </div>
    </div>
  );
}
