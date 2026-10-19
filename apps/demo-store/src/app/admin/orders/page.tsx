import { ChevronRightIcon } from "@radix-ui/react-icons";
import { ShellNotice, StoreShell } from "@/components/store-shell";

const columns = ["Order", "Buyer", "Placed", "Total", "Evidence links"];

export default function OrdersPage() {
  return (
    <StoreShell area="admin">
      <div className="mx-auto max-w-[1100px] px-5 py-10 sm:px-8 sm:py-14">
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-sage">Seller admin</p>
        <h1 className="mt-3 text-[36px] font-semibold leading-[42px] tracking-[-0.04em]">Orders</h1>
        <p className="mt-2 max-w-[62ch] text-sm leading-6 text-muted">
          Order, shipment, message, customer, refund, subscription, and download records join here in Day 3.
        </p>
        <div className="mt-8">
          <ShellNotice label="Day 2 shell">
            No records are implied yet. Synthetic catalog and orders arrive through the repeatable seed.
          </ShellNotice>
        </div>
        <section
          className="mt-8 overflow-hidden rounded-[8px] border border-border bg-surface"
          aria-label="Order administration shell"
        >
          <div className="hidden grid-cols-[1fr_1fr_1fr_0.7fr_1fr] gap-4 border-b border-border bg-canvas px-5 py-3 font-mono text-[11px] uppercase tracking-[0.08em] text-muted md:grid">
            {columns.map((column) => (
              <span key={column}>{column}</span>
            ))}
          </div>
          <div className="grid min-h-[260px] place-items-center px-6 py-12 text-center">
            <div>
              <div className="mx-auto grid size-11 place-items-center rounded-[6px] border border-border bg-canvas">
                <ChevronRightIcon aria-hidden className="text-muted" />
              </div>
              <h2 className="mt-4 text-lg font-semibold tracking-[-0.02em]">No seeded store orders yet</h2>
              <p className="mx-auto mt-2 max-w-[46ch] text-sm leading-6 text-muted">
                This empty state will be replaced only by database results, never by fallback rows after a
                failed request.
              </p>
            </div>
          </div>
        </section>
      </div>
    </StoreShell>
  );
}
