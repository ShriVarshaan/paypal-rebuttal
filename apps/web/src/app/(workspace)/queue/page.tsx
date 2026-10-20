import type { Metadata } from "next";
import { Suspense } from "react";
import { QueueScaffold } from "@/components/queue/queue-scaffold";

export const metadata: Metadata = { title: "Queue" };

export default function QueuePage() {
  return (
    <Suspense fallback={null}>
      <QueueScaffold />
    </Suspense>
  );
}
