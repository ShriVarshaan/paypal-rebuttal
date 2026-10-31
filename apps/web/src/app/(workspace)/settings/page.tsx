import type { Metadata } from "next";
import { PolicyForm } from "@/components/settings/policy-form";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <p className="text-[11px] font-bold uppercase tracking-[0.055em] text-accent-strong">Policy</p>
      <h1 className="mt-2 text-[28px] font-semibold leading-[34px] tracking-[-0.025em] text-foreground-strong">
        Settings
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
        How much Rebuttal may do on its own, and the costs its expected-value math uses. Changes apply to the
        next recommendation; decisions already proposed keep the policy they were made with.
      </p>
      <div className="mt-8">
        <PolicyForm />
      </div>
    </div>
  );
}
