"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  ChevronRightIcon,
  Cross2Icon,
  DashboardIcon,
  GearIcon,
  HamburgerMenuIcon,
  MoonIcon,
  ReaderIcon,
  RowsIcon,
  SunIcon,
} from "@radix-ui/react-icons";
import { useTheme } from "next-themes";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { MerchantSummary } from "@rebuttal/core";
import { useQuery } from "@tanstack/react-query";
import { useLiveStatus } from "@/components/live-updates";
import { NotificationsBell } from "@/components/notifications";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/queue", label: "Queue", icon: RowsIcon, available: true },
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon, available: true },
  { href: "/eval", label: "Eval", icon: ReaderIcon, available: true },
  { href: "/settings", label: "Settings", icon: GearIcon, available: true },
] as const;

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary navigation" className="mt-8 space-y-1">
      {navItems.map((item) => {
        const active =
          pathname === item.href ||
          pathname.startsWith(`${item.href}/`) ||
          (item.href === "/queue" && pathname.startsWith("/cases/"));
        const Icon = item.icon;
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex min-h-11 items-center gap-3 rounded-[6px] px-3 text-sm font-semibold text-muted outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas hover:bg-surface-subdued hover:text-foreground-strong",
              active &&
                "bg-accent-soft text-foreground-strong before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r-full before:bg-accent",
            )}
            href={item.href}
            key={item.href}
            onClick={onNavigate}
          >
            <Icon aria-hidden className="size-4" />
            <span>{item.label}</span>
            {!item.available && (
              <span className="ml-auto rounded-full border border-border bg-surface px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.055em] text-muted">
                Later
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div>
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-[8px] border border-accent/20 bg-accent-soft text-sm font-bold text-accent-strong">
            R
          </div>
          <div>
            <p className="text-[15px] font-bold tracking-[-0.02em] text-foreground-strong">Rebuttal</p>
            <p className="text-xs text-muted">Dispute desk</p>
          </div>
        </div>
        <Navigation onNavigate={onNavigate} />
      </div>
      <div className="mt-auto border-t border-border pt-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.055em] text-muted">Updates</p>
        <LiveIndicator />
        <Link
          className="mt-3 block text-xs font-semibold text-accent-strong hover:underline"
          href="/onboarding"
          onClick={onNavigate}
        >
          Connections &amp; setup
        </Link>
      </div>
    </div>
  );
}

function ThemeButton() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = mounted && resolvedTheme === "dark";
  return (
    <Button
      aria-label={dark ? "Use light theme" : "Use dark theme"}
      onClick={() => setTheme(dark ? "light" : "dark")}
      title={dark ? "Use light theme" : "Use dark theme"}
      variant="icon"
    >
      {dark ? <SunIcon aria-hidden /> : <MoonIcon aria-hidden />}
    </Button>
  );
}

function MobileNavigation() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root onOpenChange={setOpen} open={open}>
      <Dialog.Trigger asChild>
        <Button aria-label="Open navigation" className="md:hidden" variant="icon">
          <HamburgerMenuIcon aria-hidden />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in" />
        <Dialog.Content className="surface-shadow fixed inset-y-0 left-0 z-50 w-[min(86vw,320px)] border-r border-border bg-surface p-5 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left">
          <Dialog.Title className="sr-only">Primary navigation</Dialog.Title>
          <Dialog.Description className="sr-only">
            Navigate between Rebuttal workspace sections.
          </Dialog.Description>
          <Dialog.Close asChild>
            <Button aria-label="Close navigation" className="absolute right-3 top-3" variant="icon">
              <Cross2Icon aria-hidden />
            </Button>
          </Dialog.Close>
          <SidebarContent onNavigate={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function LiveIndicator() {
  const status = useLiveStatus();
  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-foreground" role="status">
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          status === "live" ? "bg-success" : status === "connecting" ? "bg-warning" : "bg-danger",
        )}
      />
      {status === "live" ? "Live" : status === "connecting" ? "Connecting…" : "Offline · polling"}
    </div>
  );
}

function MerchantName() {
  const query = useQuery({
    queryKey: ["merchant"],
    queryFn: () => apiGet("merchant", MerchantSummary),
    staleTime: 5 * 60_000,
  });
  return (
    <div>
      <p className="text-sm font-semibold text-foreground-strong">{query.data?.name ?? " "}</p>
      <p className="hidden text-xs text-muted sm:block">
        {query.data
          ? `PayPal sandbox · ${query.data.defaultCurrency}`
          : query.error
            ? "Merchant unavailable"
            : " "}
      </p>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[224px_minmax(0,1fr)]">
      <aside className="fixed inset-y-0 left-0 hidden w-56 border-r border-border bg-surface p-5 md:block">
        <SidebarContent />
      </aside>
      <div className="min-w-0 md:col-start-2">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-canvas/95 px-4 backdrop-blur-sm md:px-8">
          <div className="flex items-center gap-3">
            <MobileNavigation />
            <MerchantName />
          </div>
          <div className="flex items-center gap-2">
            <NotificationsBell />
            <ThemeButton />
          </div>
        </header>
        <main className="px-4 py-7 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

export function FutureFeature({
  description,
  milestone,
  title,
}: {
  description: string;
  milestone: string;
  title: string;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <p className="text-[11px] font-bold uppercase tracking-[0.055em] text-accent-strong">{milestone}</p>
        <h1 className="mt-2 text-[28px] font-semibold leading-[34px] tracking-[-0.025em] text-foreground-strong">
          {title}
        </h1>
      </div>
      <section className="rounded-[8px] border border-border bg-surface p-6 md:p-8">
        <div className="grid size-11 place-items-center rounded-[8px] border border-accent/20 bg-accent-soft text-accent-strong">
          <ChevronRightIcon aria-hidden />
        </div>
        <h2 className="mt-6 text-lg font-semibold tracking-[-0.015em] text-foreground-strong">
          Planned, not simulated
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{description}</p>
        <Link
          className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent-strong outline-none focus-visible:ring-2 focus-visible:ring-accent"
          href="/queue"
        >
          Return to the Week 1 queue
          <ChevronRightIcon aria-hidden />
        </Link>
      </section>
    </div>
  );
}
