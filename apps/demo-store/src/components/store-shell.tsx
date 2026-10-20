import { BackpackIcon, DashboardIcon, Pencil2Icon } from "@radix-ui/react-icons";
import Link from "next/link";
import type { ReactNode } from "react";

const nav = [
  { href: "/p/speckled-serving-bowl", label: "Storefront", icon: BackpackIcon },
  { href: "/admin/products/product-speckled-bowl/edit", label: "Product editor", icon: Pencil2Icon },
  { href: "/admin/orders", label: "Orders", icon: DashboardIcon },
] as const;

export function StoreShell({ children, area }: { children: ReactNode; area: "store" | "admin" }) {
  return (
    <div className="min-h-screen">
      <div className="border-b border-border bg-surface">
        <div className="mx-auto flex min-h-11 max-w-[1200px] items-center justify-between gap-4 px-5 py-2 text-xs text-muted sm:px-8">
          <span>Independent goods for slower days.</span>
          <span className="font-mono uppercase tracking-[0.12em] text-sage">Synthetic demo store</span>
        </div>
      </div>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-5 py-6 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Link href="/" className="text-xl font-semibold tracking-[-0.03em] text-ink">
              Fern & Field Goods
            </Link>
            <p className="mt-1 text-xs text-muted">Made-up records for local evidence workflows</p>
          </div>
          <nav aria-label="Demo store navigation" className="flex flex-wrap gap-2">
            {nav.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="inline-flex min-h-11 items-center gap-2 rounded-[6px] border border-border bg-surface px-3.5 text-sm font-medium text-ink transition-colors hover:border-clay hover:bg-clay-soft focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <Icon aria-hidden />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer className="mt-20 border-t border-border bg-surface">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-2 px-5 py-8 text-xs text-muted sm:px-8 md:flex-row md:items-center md:justify-between">
          <span>Fern & Field Goods is fictional. No customer or payment data is real.</span>
          <span className="font-mono uppercase tracking-[0.1em]">
            {area === "admin" ? "Seller records" : "Storefront"}
          </span>
        </div>
      </footer>
    </div>
  );
}

export function ShellNotice({ label, children }: { label: string; children: ReactNode }) {
  return (
    <aside className="rounded-[8px] border border-clay/30 bg-clay-soft px-4 py-3 text-sm leading-6 text-ink">
      <span className="mr-2 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-clay">
        {label}
      </span>
      {children}
    </aside>
  );
}
