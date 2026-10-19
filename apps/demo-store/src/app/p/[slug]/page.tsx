import { ArrowRightIcon } from "@radix-ui/react-icons";
import { ShellNotice, StoreShell } from "@/components/store-shell";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <StoreShell area="store">
      <div className="mx-auto max-w-[1200px] px-5 py-10 sm:px-8 sm:py-14">
        <ShellNotice label="Day 2 shell">
          Product data and immutable listing revisions connect in Day 3. This route is intentionally not a
          fixture fallback.
        </ShellNotice>
        <div className="mt-8 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          <div className="grid min-h-[420px] place-items-center rounded-[8px] border border-border bg-[#e8e1d5] p-8 text-center lg:min-h-[620px]">
            <div>
              <div className="mx-auto size-20 rounded-full border border-clay/40 bg-clay-soft" />
              <p className="mt-5 font-mono text-xs uppercase tracking-[0.12em] text-muted">
                Product photography · Day 3
              </p>
            </div>
          </div>
          <section className="lg:sticky lg:top-8">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-sage">
              Homeware · draft listing
            </p>
            <h1 className="mt-4 max-w-[12ch] text-[42px] font-semibold leading-[46px] tracking-[-0.045em] sm:text-[54px] sm:leading-[58px]">
              Speckled serving bowl
            </h1>
            <p className="mt-5 font-mono text-xl">$74.50</p>
            <p className="mt-6 max-w-[52ch] text-[15px] leading-7 text-muted">
              A quiet placeholder for the purchase-time listing renderer. The connected version will show the
              exact title, copy, assets, price, attributes, and capture revision stored for an order.
            </p>
            <dl className="mt-8 divide-y divide-border border-y border-border text-sm">
              <div className="flex justify-between gap-5 py-4">
                <dt className="text-muted">Route key</dt>
                <dd className="font-mono text-xs">{slug}</dd>
              </div>
              <div className="flex justify-between gap-5 py-4">
                <dt className="text-muted">Renderer</dt>
                <dd>Storefront v1 pending</dd>
              </div>
              <div className="flex justify-between gap-5 py-4">
                <dt className="text-muted">Evidence use</dt>
                <dd>Historical listing</dd>
              </div>
            </dl>
            <button
              type="button"
              disabled
              className="mt-8 inline-flex min-h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-[6px] bg-ink px-5 text-sm font-semibold text-surface opacity-55"
            >
              Checkout is outside this shell
              <ArrowRightIcon aria-hidden />
            </button>
          </section>
        </div>
      </div>
    </StoreShell>
  );
}
