import type { Metadata } from "next";
import { QueueScaffold } from "@/components/queue/queue-scaffold";

export const metadata: Metadata = { title: "Queue" };

export default function QueuePage() {
  return <QueueScaffold />;
}
