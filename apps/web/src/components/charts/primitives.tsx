"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Width of a container, so SVG charts draw at real pixels and text never stretches. */
export function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(
      ([entry]) => entry && setWidth(Math.max(240, Math.floor(entry.contentRect.width))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/** Clean axis ticks: 0, 1, 2, 5 × 10ⁿ steps. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(+v.toFixed(10));
  if (ticks.at(-1)! < max) ticks.push(+(ticks.at(-1)! + step).toFixed(10));
  return ticks;
}

export interface LegendItem {
  label: string;
  color: string;
  shape?: "line" | "rect";
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((i) => (
        <li className="flex items-center gap-1.5" key={i.label}>
          <span
            aria-hidden
            className={cn(
              "inline-block",
              i.shape === "line" ? "h-0.5 w-4 rounded-full" : "size-2.5 rounded-[2px]",
            )}
            style={{ background: i.color }}
          />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Chart card: title, optional legend, chart, and a "show as table" view so nothing is hover-only. */
export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  children,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  legend?: LegendItem[];
  table?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={cn("rounded-[8px] border border-border bg-surface p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground-strong">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs leading-5 text-muted">{subtitle}</p> : null}
        </div>
        {table ? (
          <button
            aria-pressed={asTable}
            className="min-h-8 rounded-[6px] border border-border px-2.5 text-xs font-semibold text-muted hover:bg-surface-subdued"
            onClick={() => setAsTable((v) => !v)}
            type="button"
          >
            {asTable ? "Show chart" : "Show table"}
          </button>
        ) : null}
      </div>
      {legend && !asTable ? (
        <div className="mt-3">
          <Legend items={legend} />
        </div>
      ) : null}
      <div className="mt-4">{asTable && table ? table : children}</div>
    </section>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-[0.055em] text-muted">
            {head.map((h, i) => (
              <th className={cn("px-2 py-2 font-semibold", i > 0 && "text-right")} key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr className="border-b border-border last:border-0" key={i}>
              {r.map((cell, j) => (
                <td className={cn("px-2 py-2", j > 0 && "mono text-right text-xs")} key={j}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Stat tile: sentence-case label, one semibold value, optional context line. */
export function StatTile({
  label,
  value,
  context,
  tone,
  hero,
}: {
  label: string;
  value: ReactNode;
  context?: ReactNode;
  tone?: "success" | "danger";
  hero?: boolean;
}) {
  return (
    <div className="rounded-[8px] border border-border bg-surface p-4">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p
        className={cn(
          "mt-2 font-semibold tracking-[-0.025em] text-foreground-strong",
          hero ? "text-[44px] leading-[48px]" : "text-[26px] leading-8",
        )}
      >
        {value}
      </p>
      {context ? (
        <p
          className={cn(
            "mt-1 text-xs leading-5",
            tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-muted",
          )}
        >
          {context}
        </p>
      ) : null}
    </div>
  );
}
