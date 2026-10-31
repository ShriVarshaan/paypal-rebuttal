import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { MAX_FILE_BYTES, MAX_TOTAL_BYTES } from "@rebuttal/paypal";
import type { PdfEngine } from "./engine.js";
import { buildTimeline, fileSlug, groupByEvidenceType, orderExhibits } from "./model.js";
import { mergeSections, type Section } from "./pdf.js";
import { renderCoverHtml, renderExhibitHtml } from "./render.js";
import type { PackExhibit, PackFile, PackInput, PackResult } from "./types.js";

/** Image profiles, tried in order until every file fits PayPal's limits. */
export const PROFILES = [
  { name: "standard", maxWidth: 1280, quality: 80 },
  { name: "compact", maxWidth: 1024, quality: 62 },
  { name: "minimal", maxWidth: 800, quality: 45 },
  { name: "text-only", maxWidth: 0, quality: 0 },
] as const;

export class PackTooLargeError extends Error {
  override readonly name = "PackTooLargeError";
}

export interface BuildPackOptions {
  engine: PdfEngine;
  /** Directory the PDFs are written to; created if missing. */
  outDir: string;
  readFile?: (path: string) => Promise<Uint8Array>;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

interface Rendered {
  files: { name: string; evidenceType: string; bytes: Uint8Array; exhibits: string[]; pages: number }[];
  preview: { bytes: Uint8Array; pages: number };
}

/**
 * Builds the evidence pack for one decision: a cover letter plus one exhibit per evidence
 * item, merged into a preview PDF and split into one submission PDF per PayPal
 * evidence_type (the executor uploads each under its type). Screenshots are downscaled until
 * every file is ≤10MB and the submission ≤50MB; if even text-only exceeds them it throws.
 */
export async function buildEvidencePack(input: PackInput, opts: BuildPackOptions): Promise<PackResult> {
  const maxFile = opts.maxFileBytes ?? MAX_FILE_BYTES;
  const maxTotal = opts.maxTotalBytes ?? MAX_TOTAL_BYTES;
  const read = opts.readFile ?? ((p: string) => readFile(p));
  const exhibits = orderExhibits(input);
  const timeline = buildTimeline(input, exhibits);
  const warnings: string[] = [];

  // Load each screenshot once; profiles only change how it is re-encoded.
  const sources = new Map<string, { bytes: Uint8Array; mime: string }>();
  for (const x of exhibits) {
    const path = x.evidence.filePath;
    if (!path) continue;
    const mime = IMAGE_TYPES[extname(path).toLowerCase()];
    if (!mime) continue;
    try {
      sources.set(x.evidence.id, { bytes: await read(path), mime });
    } catch {
      warnings.push(`${x.exhibitId}: screenshot file is missing; the structured record is shown instead.`);
    }
  }

  let lastSizes = "";
  // The cover and image-free exhibits look the same at every profile; render them once.
  const fixed = new Map<string, Uint8Array>();
  for (const profile of PROFILES) {
    const images = new Map<string, string>();
    if (profile.maxWidth > 0) {
      for (const [id, src] of sources) {
        const jpeg = await opts.engine.jpeg(src.bytes, src.mime, profile);
        images.set(id, `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`);
      }
    }
    const rendered = await render(input, exhibits, timeline, images, opts.engine, fixed);
    const total = rendered.files.reduce((s, f) => s + f.bytes.byteLength, 0);
    const oversized = rendered.files.filter((f) => f.bytes.byteLength > maxFile);
    lastSizes = rendered.files
      .map((f) => `${f.name} ${(f.bytes.byteLength / 1048576).toFixed(1)}MB`)
      .join(", ");
    if (oversized.length || total > maxTotal) {
      warnings.push(
        `Profile ${profile.name} exceeded PayPal's size limits (${lastSizes}); trying a smaller one.`,
      );
      continue;
    }
    if (profile.maxWidth === 0 && sources.size)
      warnings.push(
        "Screenshots were dropped to meet PayPal's size limits; structured records are shown instead.",
      );
    return write(input, exhibits, rendered, opts.outDir, profile.name, warnings);
  }
  throw new PackTooLargeError(`Evidence pack exceeds PayPal's limits even without images (${lastSizes})`);
}

async function render(
  input: PackInput,
  exhibits: PackExhibit[],
  timeline: ReturnType<typeof buildTimeline>,
  images: Map<string, string>,
  engine: PdfEngine,
  fixed: Map<string, Uint8Array>,
): Promise<Rendered> {
  const once = async (key: string, html: () => string) => {
    let bytes = fixed.get(key);
    if (!bytes) fixed.set(key, (bytes = await engine.pdf(html())));
    return bytes;
  };
  const cover: Section = {
    label: "Cover letter",
    bytes: await once("cover", () => renderCoverHtml(input, exhibits, timeline)),
  };
  const sections = new Map<string, Section>();
  for (const x of exhibits) {
    const image = images.get(x.evidence.id) ?? null;
    sections.set(x.exhibitId, {
      label: `Exhibit ${x.exhibitId}`,
      bytes: image
        ? await engine.pdf(renderExhibitHtml(x, input, image))
        : await once(x.exhibitId, () => renderExhibitHtml(x, input, null)),
    });
  }

  const groups = groupByEvidenceType(exhibits);
  const files: Rendered["files"] = [];
  if (!groups.length) {
    const merged = await mergeSections([cover], { disputeId: input.paypalDisputeId });
    files.push({
      name: "01-seller-statement.pdf",
      evidenceType: "OTHER",
      bytes: merged.bytes,
      exhibits: [],
      pages: merged.pages,
    });
  }
  for (const [i, g] of groups.entries()) {
    const parts = [...(i === 0 ? [cover] : []), ...g.exhibits.map((x) => sections.get(x.exhibitId)!)];
    const merged = await mergeSections(parts, { disputeId: input.paypalDisputeId });
    files.push({
      name: `${String(i + 1).padStart(2, "0")}-${fileSlug(g.evidenceType)}.pdf`,
      evidenceType: g.evidenceType,
      bytes: merged.bytes,
      exhibits: g.exhibits.map((x) => x.exhibitId),
      pages: merged.pages,
    });
  }
  const preview = await mergeSections([cover, ...exhibits.map((x) => sections.get(x.exhibitId)!)], {
    disputeId: input.paypalDisputeId,
    title: `Evidence pack ${input.paypalDisputeId}`,
  });
  return { files, preview: { bytes: preview.bytes, pages: preview.pages } };
}

/** Atomic writes: a reader never sees a half-written PDF. */
async function writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, path);
}

async function write(
  input: PackInput,
  exhibits: PackExhibit[],
  rendered: Rendered,
  outDir: string,
  profile: string,
  warnings: string[],
): Promise<PackResult> {
  await mkdir(outDir, { recursive: true });
  const files: PackFile[] = [];
  for (const f of rendered.files) {
    const path = join(outDir, f.name);
    await writeAtomic(path, f.bytes);
    files.push({
      path,
      name: f.name,
      evidenceType: f.evidenceType,
      mimeType: "application/pdf",
      sizeBytes: f.bytes.byteLength,
      exhibits: f.exhibits,
      pages: f.pages,
    });
  }
  const previewPath = join(outDir, `evidence-pack-${fileSlug(input.paypalDisputeId)}.pdf`);
  await writeAtomic(previewPath, rendered.preview.bytes);
  return {
    files,
    totalBytes: files.reduce((s, f) => s + f.sizeBytes, 0),
    preview: {
      path: previewPath,
      sizeBytes: rendered.preview.bytes.byteLength,
      pages: rendered.preview.pages,
    },
    exhibits: exhibits.map((x) => ({
      exhibitId: x.exhibitId,
      evidenceId: x.evidence.id,
      title: x.heading,
      evidenceType: x.evidence.type,
    })),
    profile,
    warnings,
  };
}
