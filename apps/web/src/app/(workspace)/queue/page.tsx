import type { Metadata } from "next";
import { Suspense } from "react";
import { SetupBanner } from "@/components/onboarding/setup-banner";
import { QueueScaffold } from "@/components/queue/queue-scaffold";

export const metadata: Metadata = { title: "Queue" };

export default function QueuePage() {
  return (
    <>
      <SetupBanner />
      <Suspense fallback={null}>
        <QueueScaffold />
      </Suspense>
    </>
  );
}
