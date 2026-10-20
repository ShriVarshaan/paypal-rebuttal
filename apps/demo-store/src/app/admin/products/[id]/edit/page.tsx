import { notFound, redirect } from "next/navigation";
import { ShellNotice, StoreShell } from "@/components/store-shell";
import { createCatalog } from "@/lib/catalog";
import { getDb } from "@/lib/db";

const Field = ({
  label,
  name,
  value,
  type = "text",
}: {
  label: string;
  name: string;
  value: string;
  type?: string;
}) => (
  <label className="grid gap-2 text-sm font-medium text-ink">
    {label}
    <input
      name={name}
      type={type}
      defaultValue={value}
      required
      className="min-h-11 rounded-[6px] border border-border bg-canvas px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2"
    />
  </label>
);

export default async function ProductEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ published?: string }>;
}) {
  const { id } = await params;
  const product = await createCatalog(getDb()).product(id);
  if (!product) notFound();
  const snapshot = product.currentSnapshot;
  const { published } = await searchParams;

  async function publish(formData: FormData) {
    "use server";
    const current = await createCatalog(getDb()).product(id);
    if (!current) notFound();
    await createCatalog(getDb()).publish(id, {
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
      priceCents: Number(formData.get("priceCents")),
      currency: String(formData.get("currency") ?? ""),
      attributes: current.currentSnapshot.attributes,
      assets: current.currentSnapshot.assets,
    });
    redirect(`/admin/products/${encodeURIComponent(id)}/edit?published=1`);
  }

  return (
    <StoreShell area="admin">
      <div className="mx-auto max-w-[920px] px-5 py-10 sm:px-8 sm:py-14">
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-sage">Seller admin · {id}</p>
        <div className="mt-3 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-[36px] font-semibold leading-[42px] tracking-[-0.04em]">Edit product</h1>
            <p className="mt-2 max-w-[58ch] text-sm leading-6 text-muted">
              Every saved edit creates a new immutable listing snapshot. Earlier revisions and order
              references stay unchanged.
            </p>
          </div>
          <span className="rounded-full border border-border bg-surface px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
            Revision {snapshot.revision} · published
          </span>
        </div>
        <div className="mt-8">
          <ShellNotice label={published ? "Published" : "Immutable history"}>
            {published
              ? "A new listing revision was created. The prior version remains available to purchase-time evidence."
              : "This form publishes a new revision; it never updates a historical snapshot in place."}
          </ShellNotice>
        </div>
        <form
          className="mt-8 grid gap-6 rounded-[8px] border border-border bg-surface p-5 sm:p-7"
          action={publish}
          aria-label="Product editor"
        >
          <Field label="Title" name="title" value={snapshot.title} />
          <label className="grid gap-2 text-sm font-medium text-ink">
            Description
            <textarea
              name="description"
              rows={6}
              defaultValue={snapshot.description}
              required
              className="rounded-[6px] border border-border bg-canvas px-3 py-3 text-sm leading-6 text-ink focus-visible:outline-2 focus-visible:outline-offset-2"
            />
          </label>
          <div className="grid gap-6 sm:grid-cols-2">
            <Field
              label="Price in minor units"
              name="priceCents"
              value={String(snapshot.priceCents)}
              type="number"
            />
            <Field label="Currency" name="currency" value={snapshot.currency} />
          </div>
          <button
            type="submit"
            className="min-h-11 rounded-[6px] bg-ink px-4 text-sm font-semibold text-surface transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Save and create revision
          </button>
        </form>
      </div>
    </StoreShell>
  );
}
