import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/** One rendered section (the cover letter or one exhibit) and the label stamped on its pages. */
export interface Section {
  label: string;
  bytes: Uint8Array;
}

/**
 * Merges sections into one PDF and stamps every page's footer with the dispute, the section
 * label ("Exhibit EX-2") and "Page n of N", so a reviewer can cite a page from a printout.
 */
export async function mergeSections(
  sections: Section[],
  opts: { disputeId: string; title?: string },
): Promise<{ bytes: Uint8Array; pages: number; pagesBySection: number[] }> {
  const out = await PDFDocument.create();
  out.setTitle(opts.title ?? `Seller evidence ${opts.disputeId}`);
  out.setProducer("Rebuttal evidence pack");
  out.setCreator("Rebuttal");
  const labels: string[] = [];
  const pagesBySection: number[] = [];
  for (const section of sections) {
    const src = await PDFDocument.load(section.bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) {
      out.addPage(p);
      labels.push(section.label);
    }
    pagesBySection.push(pages.length);
  }
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const total = out.getPageCount();
  out.getPages().forEach((page, i) => {
    const { width } = page.getSize();
    const y = 18;
    const left = `Dispute ${opts.disputeId}`;
    const middle = labels[i] ?? "";
    const right = `Page ${i + 1} of ${total}`;
    const size = 8;
    const grey = rgb(0.36, 0.39, 0.37);
    page.drawLine({
      start: { x: 42, y: y + 11 },
      end: { x: width - 42, y: y + 11 },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.78),
    });
    page.drawText(left, { x: 42, y, size, font, color: grey });
    page.drawText(middle, {
      x: (width - bold.widthOfTextAtSize(middle, size)) / 2,
      y,
      size,
      font: bold,
      color: rgb(0.11, 0.14, 0.13),
    });
    page.drawText(right, { x: width - 42 - font.widthOfTextAtSize(right, size), y, size, font, color: grey });
  });
  return { bytes: await out.save(), pages: total, pagesBySection };
}
