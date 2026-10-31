"use client";

import type React from "react";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChartTooltip, useChartTooltip } from "./tooltip";

export interface EvBar {
  key: string;
  label: string;
  detail: string;
  cents: number;
}

/**
 * Expected value of each option, in dollars against refunding in full. One series, so the
 * best option is emphasised in the accent and the others stay neutral (no extra hues). Bars
 * grow from a shared zero baseline, so a negative EV extends left and reads as a loss.
 */
export function EvBars({
  bars,
  best,
  currency,
  labelWidth = 88,
}: {
  bars: EvBar[];
  best: string;
  currency: string;
  labelWidth?: number;
}) {
  const { tip, show, hide } = useChartTooltip();
  const values = bars.map((b) => b.cents);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const zero = ((0 - min) / span) * 100;
  return (
    <div className="relative" data-chart onPointerLeave={hide}>
      <div className="grid gap-3">
        {bars.map((bar) => {
          const width = (Math.abs(bar.cents) / span) * 100;
          const left = bar.cents >= 0 ? zero : zero - width;
          const isBest = bar.key === best;
          const value = formatMoney(Math.round(bar.cents), currency, { signed: true });
          const content = (
            <>
              <p className="mono text-sm font-semibold text-foreground-strong">{value}</p>
              <p className="mt-0.5 text-muted">{bar.label}</p>
              <p className="mt-1 max-w-56 text-muted">{bar.detail}</p>
            </>
          );
          return (
            <div
              aria-label={`${bar.label}: expected value ${value}${isBest ? ", highest" : ""}`}
              className="grid grid-cols-[var(--label-w)_minmax(0,1fr)_88px] items-center gap-3 rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-accent"
              key={bar.key}
              onBlur={hide}
              onFocus={(e) => show(e, content)}
              onPointerMove={(e) => show(e, content)}
              role="img"
              style={{ "--label-w": `${labelWidth}px` } as React.CSSProperties}
              tabIndex={0}
            >
              <span className={cn("text-sm", isBest ? "font-semibold text-foreground-strong" : "text-muted")}>
                {bar.label}
              </span>
              <div className="relative h-6">
                <span
                  aria-hidden
                  className="absolute inset-y-0 w-px bg-border-strong"
                  style={{ left: `${zero}%` }}
                />
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-1/2 h-4 -translate-y-1/2 transition-[width,left] duration-200",
                    bar.cents >= 0 ? "rounded-r-[4px]" : "rounded-l-[4px]",
                    isBest ? "bg-accent" : "bg-border-strong",
                  )}
                  style={{ left: `${left}%`, width: `max(${width}%, 2px)` }}
                />
              </div>
              <span
                className={cn(
                  "mono text-right text-sm",
                  isBest ? "font-semibold text-foreground-strong" : "text-muted",
                )}
              >
                {value}
              </span>
            </div>
          );
        })}
      </div>
      <ChartTooltip tip={tip} />
    </div>
  );
}
