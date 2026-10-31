import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { LiveUpdates } from "@/components/live-updates";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <LiveUpdates>
      <AppShell>{children}</AppShell>
    </LiveUpdates>
  );
}
