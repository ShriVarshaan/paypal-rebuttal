"use client";

import { ChartTooltip, useChartTooltip } from "./tooltip";
import { useWidth } from "./primitives";

export interface Bin {
  from: number;
  to: number;
  n: number;
  meanPredicted: number;
  winRate: number;
}

/**
 * Reliability diagram: predicted p(win) against the observed win rate per bin. The diagonal
 * is perfect calibration; dot area grows with the number of cases in the bin.
 */
export function ReliabilityChart({ bins, height = 260 }: { bins: Bin[]; height?: number }) {
  const { ref, width } = useWidth<HTMLDivElement>(320);
  const { tip, show, hide } = useChartTooltip();
  const size = Math.min(width, height + 40);
  const pad = { top: 10, right: 12, bottom: 34, left: 42 };
  const w = size - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const x = (v: number) => pad.left + v * w;
  const y = (v: number) => pad.top + h - v * h;
  const maxN = Math.max(1, ...bins.map((b) => b.n));
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="relative" data-chart onPointerLeave={hide} ref={ref}>
      <svg aria-label="Reliability diagram" className="block" height={height} role="img" width={size}>
        {ticks.map((t) => (
          <g key={t}>
            <line stroke="var(--border)" x1={pad.left} x2={pad.left + w} y1={y(t)} y2={y(t)} />
            <text
              className="fill-[var(--muted)] text-[11px]"
              dominantBaseline="middle"
              textAnchor="end"
              x={pad.left - 6}
              y={y(t)}
            >
              {t * 100}%
            </text>
            <text
              className="fill-[var(--muted)] text-[11px]"
              textAnchor="middle"
              x={x(t)}
              y={pad.top + h + 16}
            >
              {t * 100}%
            </text>
          </g>
        ))}
        <text
          className="fill-[var(--muted)] text-[11px]"
          textAnchor="middle"
          x={pad.left + w / 2}
          y={height - 2}
        >
          Predicted p(win)
        </text>
        <line stroke="var(--border-strong)" strokeWidth={1} x1={x(0)} x2={x(1)} y1={y(0)} y2={y(1)} />
        <text className="fill-[var(--muted)] text-[11px]" textAnchor="end" x={x(1) - 4} y={y(1) + 14}>
          perfect
        </text>
        {bins.map((b) => {
          const content = (
            <>
              <p className="mono text-sm font-semibold text-foreground-strong">
                {Math.round(b.winRate * 100)}% won
              </p>
              <p className="text-muted">
                predicted {Math.round(b.meanPredicted * 100)}% · {b.n} case{b.n === 1 ? "" : "s"}
              </p>
            </>
          );
          return (
            <circle
              aria-label={`Predicted ${Math.round(b.meanPredicted * 100)}%, won ${Math.round(b.winRate * 100)}%, ${b.n} cases`}
              className="outline-none focus-visible:stroke-[var(--foreground-strong)]"
              cx={x(b.meanPredicted)}
              cy={y(b.winRate)}
              fill="var(--accent)"
              key={b.from}
              onBlur={hide}
              onFocus={(e) => show(e, content)}
              onPointerMove={(e) => show(e, content)}
              r={4 + 6 * Math.sqrt(b.n / maxN)}
              role="img"
              stroke="var(--surface)"
              strokeWidth={2}
              tabIndex={0}
            />
          );
        })}
      </svg>
      <ChartTooltip tip={tip} />
    </div>
  );
}
