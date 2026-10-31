import type { Metadata } from "next";
import { Onboarding } from "@/components/onboarding/onboarding";

export const metadata: Metadata = { title: "Setup" };

export default function OnboardingPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <p className="text-[11px] font-bold uppercase tracking-[0.055em] text-accent-strong">Setup</p>
      <h1 className="mt-2 text-[28px] font-semibold leading-[34px] tracking-[-0.025em] text-foreground-strong">
        Connect Rebuttal to your business
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
        Four steps, a few minutes. Rebuttal only ever talks to the PayPal sandbox.
      </p>
      <div className="mt-7">
        <Onboarding />
      </div>
    </div>
  );
}
