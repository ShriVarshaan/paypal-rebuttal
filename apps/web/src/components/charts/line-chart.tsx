"use client";

import { useState } from "react";
import { niceTicks, useWidth } from "./primitives";

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
}

/**
 * Lines on one axis with a crosshair that snaps to the nearest x and lists every series.
 * 2px lines, round joins, recessive hairline grid, end labels on the last value.
 */
export function LineChart({
  xLabels,
  series,
  format,
  height = 220,
  reference,
  step = false,
}: {
  xLabels: string[];
  series: LineSeries[];
  format: (v: number) => string;
  height?: number;
  /** A labelled horizontal reference, e.g. PayPal's review threshold. */
  reference?: { value: number; label: string };
  /** Step lines for cumulative totals that change at discrete events. */
  step?: boolean;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 12, right: 72, bottom: 26, left: 56 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const values = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const ticks = niceTicks(Math.max(...values, reference?.value ?? 0, 0) || 1);
  const yMax = ticks.at(-1)!;
  const n = xLabels.length;
  const x = (i: number) => pad.left + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => pad.top + h - (v / yMax) * h;
  const path = (vals: (number | null)[]) => {
    let d = "";
    let prev: number | null = null;
    vals.forEach((v, i) => {
      if (v == null) {
        prev = null;
        return;
      }
      if (prev == null) d += `M${x(i)},${y(v)}`;
      else d += step ? `H${x(i)}V${y(v)}` : `L${x(i)},${y(v)}`;
      prev = v;
    });
    return d;
  };
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 72))));

  return (
    <div className="relative" ref={ref}>
      <svg
        aria-label={`Line chart: ${series.map((s) => s.label).join(", ")}`}
        className="block overflow-visible"
        height={height}
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => {
          const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = e.clientX - box.left - pad.left;
          setHover(Math.max(0, Math.min(n - 1, Math.round((px / Math.max(w, 1)) * (n - 1)))));
        }}
        role="img"
        width={width}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              stroke="var(--border)"
              strokeWidth={1}
              x1={pad.left}
              x2={pad.left + w}
              y1={y(t)}
              y2={y(t)}
            />
            <text
              className="fill-[var(--muted)] text-[11px]"
              dominantBaseline="middle"
              textAnchor="end"
              x={pad.left - 8}
              y={y(t)}
            >
              {format(t)}
            </text>
          </g>
        ))}
        {xLabels.map((l, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <text
              className="fill-[var(--muted)] text-[11px]"
              key={i}
              textAnchor="middle"
              x={x(i)}
              y={height - 6}
            >
              {l}
            </text>
          ) : null,
        )}
        {reference ? (
          <g>
            <line
              stroke="var(--warning)"
              strokeWidth={1}
              x1={pad.left}
              x2={pad.left + w}
              y1={y(reference.value)}
              y2={y(reference.value)}
            />
            <text
              className="fill-[var(--warning)] text-[11px] font-semibold"
              dominantBaseline="middle"
              x={pad.left + w + 6}
              y={y(reference.value)}
            >
              {reference.label}
            </text>
          </g>
        ) : null}
        {series.map((s) => (
          <path
            d={path(s.values)}
            fill="none"
            key={s.key}
            stroke={s.color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
          />
        ))}
        {series.map((s) => {
          const last = s.values
            .map((v, i) => [v, i] as const)
            .filter(([v]) => v != null)
            .at(-1);
          if (!last) return null;
          return (
            <g key={`${s.key}-end`}>
              <circle
                cx={x(last[1])}
                cy={y(last[0]!)}
                fill={s.color}
                r={4}
                stroke="var(--surface)"
                strokeWidth={2}
              />
              {series.length <= 4 ? (
                <text
                  className="fill-[var(--foreground-strong)] text-[11px] font-semibold"
                  dominantBaseline="middle"
                  x={x(last[1]) + 8}
                  y={y(last[0]!)}
                >
                  {format(last[0]!)}
                </text>
              ) : null}
            </g>
          );
        })}
        {hover != null ? (
          <g>
            <line
              stroke="var(--border-strong)"
              strokeWidth={1}
              x1={x(hover)}
              x2={x(hover)}
              y1={pad.top}
              y2={pad.top + h}
            />
            {series.map((s) =>
              s.values[hover] != null ? (
                <circle
                  cx={x(hover)}
                  cy={y(s.values[hover]!)}
                  fill={s.color}
                  key={s.key}
                  r={4}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              ) : null,
            )}
          </g>
        ) : null}
      </svg>
      {hover != null ? (
        <div
          className="surface-shadow pointer-events-none absolute top-0 z-10 min-w-36 rounded-[6px] border border-border bg-surface px-3 py-2 text-xs"
          role="tooltip"
          style={{ left: Math.min(x(hover) + 12, width - 160) }}
        >
          <p className="text-muted">{xLabels[hover]}</p>
          {series.map((s) => (
            <p className="mt-1 flex items-center gap-2" key={s.key}>
              <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
              <span className="mono font-semibold text-foreground-strong">
                {s.values[hover] == null ? "—" : format(s.values[hover]!)}
              </span>
              <span className="text-muted">{s.label}</span>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
