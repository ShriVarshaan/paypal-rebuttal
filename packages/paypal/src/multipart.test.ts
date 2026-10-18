import { describe, expect, it } from "vitest";
import { EvidenceFileTypeError, EvidenceTooLargeError, EvidenceValidationError } from "./errors.js";
import { MAX_FILE_BYTES, buildMultipart, mimeTypeForFilename, validateEvidenceFiles } from "./multipart.js";
import { pdf } from "./testing/files.js";

describe("evidence file checks", () => {
  it("accepts PDF/PNG/JPG with matching content", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]);
    expect(() =>
      validateEvidenceFiles([
        pdf("a.pdf"),
        { filename: "b.png", contentType: "image/png", data: png },
        { filename: "c.JPG", contentType: "image/jpeg", data: jpg },
      ]),
    ).not.toThrow();
  });

  it("rejects a 12MB file before upload", () => {
    expect(() => validateEvidenceFiles([pdf("big.pdf", 12 * 1024 * 1024)])).toThrow(EvidenceTooLargeError);
  });

  it("allows exactly 10MB per file but rejects more than 50MB in total", () => {
    expect(() => validateEvidenceFiles([pdf("ok.pdf", MAX_FILE_BYTES)])).not.toThrow();
    const six = Array.from({ length: 6 }, (_, i) => pdf(`f${i}.pdf`, 9 * 1024 * 1024));
    expect(() => validateEvidenceFiles(six)).toThrow(/totals 54MB/);
  });

  it("rejects wrong types, mislabelled content, paths and duplicates", () => {
    expect(() => validateEvidenceFiles([{ ...pdf("a.pdf"), contentType: "image/gif" as never }])).toThrow(
      EvidenceFileTypeError,
    );
    expect(() => validateEvidenceFiles([{ ...pdf("a.png"), contentType: "image/png" }])).toThrow(
      EvidenceFileTypeError,
    );
    expect(() => validateEvidenceFiles([pdf("a.txt")])).toThrow(EvidenceFileTypeError);
    expect(() => validateEvidenceFiles([pdf("../a.pdf")])).toThrow(EvidenceValidationError);
    expect(() => validateEvidenceFiles([pdf("a.pdf"), pdf("a.pdf")])).toThrow(/Duplicate/);
  });

  it("maps filenames to mime types", () => {
    expect(mimeTypeForFilename("x.PDF")).toBe("application/pdf");
    expect(mimeTypeForFilename("x.jpeg")).toBe("image/jpeg");
    expect(mimeTypeForFilename("x.gif")).toBeUndefined();
  });
});

describe("buildMultipart", () => {
  it("puts the JSON in an `input` part and each file in its own part", async () => {
    const form = buildMultipart(
      { evidences: [{ evidence_type: "OTHER", documents: [{ name: "a.pdf" }] }] },
      [pdf("a.pdf")],
      "evidence-file",
    );
    const input = form.get("input") as Blob;
    expect(input.type).toBe("application/json");
    expect(JSON.parse(await input.text())).toEqual({
      evidences: [{ evidence_type: "OTHER", documents: [{ name: "a.pdf" }] }],
    });
    const file = form.get("evidence-file") as File;
    expect(file.name).toBe("a.pdf");
    expect(file.type).toBe("application/pdf");
    expect(file.size).toBe(1024);
  });
});
