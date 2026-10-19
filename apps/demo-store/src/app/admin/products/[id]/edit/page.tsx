import { ShellNotice, StoreShell } from "@/components/store-shell";

const Field = ({ label, value }: { label: string; value: string }) => (
  <label className="grid gap-2 text-sm font-medium text-ink">
    {label}
    <input
      disabled
      value={value}
      readOnly
      className="min-h-11 rounded-[6px] border border-border bg-canvas px-3 text-sm text-muted disabled:cursor-not-allowed"
    />
  </label>
);

export default async function ProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <StoreShell area="admin">
      <div className="mx-auto max-w-[920px] px-5 py-10 sm:px-8 sm:py-14">
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-sage">Seller admin · {id}</p>
        <div className="mt-3 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-[36px] font-semibold leading-[42px] tracking-[-0.04em]">Edit product</h1>
            <p className="mt-2 max-w-[58ch] text-sm leading-6 text-muted">
              Every saved edit will create a new immutable listing snapshot in Day 3.
            </p>
          </div>
          <span className="rounded-full border border-border bg-surface px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
            Revision 1 draft
          </span>
        </div>
        <div className="mt-8">
          <ShellNotice label="Read-only shell">
            Saving is disabled until snapshot persistence and validation are connected.
          </ShellNotice>
        </div>
        <form
          className="mt-8 grid gap-6 rounded-[8px] border border-border bg-surface p-5 sm:p-7"
          aria-label="Product editor shell"
        >
          <Field label="Title" value="Speckled serving bowl" />
          <label className="grid gap-2 text-sm font-medium text-ink">
            Description
            <textarea
              disabled
              readOnly
              rows={6}
              value="Historical product copy will be stored with every revision."
              className="rounded-[6px] border border-border bg-canvas px-3 py-3 text-sm leading-6 text-muted disabled:cursor-not-allowed"
            />
          </label>
          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="Price in minor units" value="7450" />
            <Field label="Currency" value="USD" />
          </div>
          <button
            type="button"
            disabled
            className="min-h-11 rounded-[6px] bg-ink px-4 text-sm font-semibold text-surface opacity-55"
          >
            Save and create revision
          </button>
        </form>
      </div>
    </StoreShell>
  );
}
