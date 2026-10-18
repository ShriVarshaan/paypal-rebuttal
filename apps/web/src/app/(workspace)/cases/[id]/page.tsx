import Link from "next/link";
import { ChevronLeftIcon } from "@radix-ui/react-icons";
import { Badge } from "@/components/ui/badge";
import { demoCases } from "@/lib/demo-cases";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = demoCases.find((entry) => entry.id === id);
  return (
    <div className="mx-auto max-w-6xl">
      <Link
        className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent-strong outline-none focus-visible:ring-2 focus-visible:ring-accent"
        href="/queue"
      >
        <ChevronLeftIcon aria-hidden />
        Back to queue
      </Link>
      <div className="mt-5 flex flex-col gap-3 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mono text-xs text-muted">{row?.paypalDisputeId ?? id}</p>
          <h1 className="mt-2 text-[28px] font-semibold leading-[34px] tracking-[-0.025em] text-foreground-strong">
            Case detail
          </h1>
        </div>
        <Badge tone="accent">Day 1 shell</Badge>
      </div>
      <section className="mt-7 rounded-[8px] border border-dashed border-border-strong bg-surface p-6 md:p-8">
        <p className="text-[11px] font-bold uppercase tracking-[0.055em] text-accent-strong">Day 5</p>
        <h2 className="mt-3 text-lg font-semibold tracking-[-0.015em] text-foreground-strong">
          Connected case context is coming next
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          This route is intentionally navigable now. The transaction context, timeline, evidence checklist,
          and safe preview will be connected after the queue API contract is in place.
        </p>
      </section>
    </div>
  );
}
