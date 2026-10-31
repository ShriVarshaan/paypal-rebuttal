"use client";

import { cn } from "@/lib/utils";

/**
 * Confusion matrix: rows are the labelled answer, columns the strategy's choice. One hue,
 * light→dark by count (sequential); the diagonal is outlined so "correct" reads without color.
 */
export function ConfusionMatrix({
  labels,
  matrix,
}: {
  labels: string[];
  matrix: Record<string, Record<string, number>>;
}) {
  const max = Math.max(1, ...labels.flatMap((r) => labels.map((c) => matrix[r]?.[c] ?? 0)));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-[3px] text-sm">
        <thead>
          <tr>
            <th
              className="w-28 text-left text-[11px] font-semibold uppercase tracking-[0.055em] text-muted"
              scope="col"
            >
              Label ↓ / chose →
            </th>
            {labels.map((c) => (
              <th className="mono pb-1 text-center text-xs font-semibold text-muted" key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((r) => (
            <tr key={r}>
              <th className="mono pr-2 text-left text-xs font-semibold text-muted" scope="row">
                {r}
              </th>
              {labels.map((c) => {
                const v = matrix[r]?.[c] ?? 0;
                const t = v / max;
                return (
                  <td
                    aria-label={`Labelled ${r}, chose ${c}: ${v}`}
                    className={cn(
                      "mono h-14 rounded-[4px] text-center text-base font-semibold",
                      r === c && "ring-2 ring-inset ring-foreground-strong/70",
                      t > 0.55 ? "text-accent-foreground" : "text-foreground-strong",
                    )}
                    key={c}
                    style={{
                      background: v
                        ? `color-mix(in oklab, var(--accent) ${Math.round(18 + t * 82)}%, var(--surface))`
                        : "var(--surface-subdued)",
                    }}
                  >
                    {v}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
