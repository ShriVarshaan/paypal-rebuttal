"use client";

import { ChartTooltip, useChartTooltip } from "./tooltip";

export interface Segment {
  key: string;
  label: string;
  color: string;
}

/**
 * Horizontal stacked bars (part-to-whole per row). Segments are separated by a 2px surface
 * gap, the bar end is rounded, and each segment has its own hover/focus tooltip.
 */
export function StackedBars({
  rows,
  segments,
}: {
  rows: { label: string; values: Record<string, number> }[];
  segments: Segment[];
}) {
  const { tip, show, hide } = useChartTooltip();
  const max = Math.max(1, ...rows.map((r) => segments.reduce((s, g) => s + (r.values[g.key] ?? 0), 0)));
  return (
    <div className="relative" data-chart onPointerLeave={hide}>
      <div className="grid gap-3">
        {rows.map((row) => {
          const total = segments.reduce((s, g) => s + (row.values[g.key] ?? 0), 0);
          return (
            <div
              className="grid grid-cols-[minmax(96px,150px)_minmax(0,1fr)_40px] items-center gap-3"
              key={row.label}
            >
              <span className="truncate text-sm text-foreground">{row.label}</span>
              <div className="flex h-5 gap-[2px]" style={{ width: `${(total / max) * 100}%` }}>
                {segments.map((g, i) => {
                  const v = row.values[g.key] ?? 0;
                  if (!v) return null;
                  const last = segments.slice(i + 1).every((s) => !(row.values[s.key] ?? 0));
                  const content = (
                    <>
                      <p className="mono text-sm font-semibold text-foreground-strong">{v}</p>
                      <p className="text-muted">
                        {g.label} · {row.label}
                      </p>
                    </>
                  );
                  return (
                    <span
                      aria-label={`${row.label}: ${v} ${g.label.toLowerCase()}`}
                      className={`h-full outline-none focus-visible:ring-2 focus-visible:ring-accent ${last ? "rounded-r-[4px]" : ""}`}
                      key={g.key}
                      onBlur={hide}
                      onFocus={(e) => show(e, content)}
                      onPointerMove={(e) => show(e, content)}
                      role="img"
                      style={{ flexGrow: v, flexBasis: 0, background: g.color }}
                      tabIndex={0}
                    />
                  );
                })}
              </div>
              <span className="mono text-right text-xs text-muted">{total}</span>
            </div>
          );
        })}
      </div>
      <ChartTooltip tip={tip} />
    </div>
  );
}
