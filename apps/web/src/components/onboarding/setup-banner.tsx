"use client";

import { ArrowRightIcon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { z } from "zod";
import { apiGet } from "@/lib/api";

const State = z.object({ merchant: z.object({ onboardedAt: z.string().nullable() }).nullable() }).loose();

/** Shown until the onboarding stepper has run its first sync. */
export function SetupBanner() {
  const query = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => apiGet("onboarding", State),
    staleTime: 60_000,
  });
  if (!query.data?.merchant || query.data.merchant.onboardedAt) return null;
  return (
    <Link
      className="mb-6 flex items-center justify-between gap-3 rounded-[8px] border border-accent/25 bg-accent-soft px-4 py-3 text-sm text-foreground-strong outline-none hover:border-accent focus-visible:ring-2 focus-visible:ring-accent"
      href="/onboarding"
    >
      <span>
        <span className="font-semibold">Finish setting up Rebuttal.</span> Connect PayPal and your store, pick
        a policy, and run the first sync.
      </span>
      <ArrowRightIcon aria-hidden className="shrink-0" />
    </Link>
  );
}
