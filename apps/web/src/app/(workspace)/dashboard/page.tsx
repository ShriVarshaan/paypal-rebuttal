import type { Metadata } from "next";
import { Dashboard } from "@/components/dashboard/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-[1500px]">
      <p className="text-[11px] font-bold uppercase tracking-[0.055em] text-accent-strong">Impact</p>
      <h1 className="mt-2 text-[28px] font-semibold leading-[34px] tracking-[-0.025em] text-foreground-strong">
        Dashboard
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
        What Rebuttal has recovered, how quickly it answers, and whether your dispute rate is heading toward
        PayPal&apos;s review level. Computed from your own cases.
      </p>
      <div className="mt-7">
        <Dashboard />
      </div>
    </div>
  );
}
