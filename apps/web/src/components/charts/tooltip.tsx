"use client";

import { useCallback, useState, type ReactNode } from "react";

export interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

/**
 * One floating tooltip per chart, positioned inside a `relative` container. Marks call
 * `show` on pointer move and on keyboard focus, so hover never gates a value.
 */
export function useChartTooltip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const show = useCallback(
    (event: { currentTarget: Element; clientX?: number; clientY?: number }, content: ReactNode) => {
      const host = event.currentTarget.closest("[data-chart]");
      if (!host) return;
      const box = host.getBoundingClientRect();
      const mark = event.currentTarget.getBoundingClientRect();
      const x = (event.clientX ?? mark.left + mark.width / 2) - box.left;
      const y = (event.clientY ?? mark.top) - box.top;
      setTip({ x, y, content });
    },
    [],
  );
  const hide = useCallback(() => setTip(null), []);
  return { tip, show, hide };
}

export function ChartTooltip({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  return (
    <div
      className="surface-shadow pointer-events-none absolute z-20 min-w-36 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-[6px] border border-border bg-surface px-3 py-2 text-xs"
      role="tooltip"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.content}
    </div>
  );
}
