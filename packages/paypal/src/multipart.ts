import { EvidenceFileTypeError, EvidenceTooLargeError, EvidenceValidationError } from "./errors.js";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

export type EvidenceMimeType = "application/pdf" | "image/png" | "image/jpeg";

export interface EvidenceFile {
  /** Must match a `documents[].name` in the JSON input. */
  filename: string;
  contentType: EvidenceMimeType;
  data: Uint8Array;
}

const EXTENSIONS: Record<EvidenceMimeType, readonly string[]> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
};

const MAGIC: Record<EvidenceMimeType, readonly number[]> = {
  "application/pdf": [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/jpeg": [0xff, 0xd8, 0xff],
};

export function mimeTypeForFilename(filename: string): EvidenceMimeType | undefined {
  const lower = filename.toLowerCase();
  for (const [mime, exts] of Object.entries(EXTENSIONS) as [EvidenceMimeType, readonly string[]][]) {
    if (exts.some((e) => lower.endsWith(e))) return mime;
  }
  return undefined;
}

/**
 * PayPal accepts PDF/PNG/JPG, at most 10MB per file and 50MB per submission (CLAUDE.md).
 * Checked locally so a bad pack fails fast instead of half-uploading.
 */
export function validateEvidenceFiles(files: readonly EvidenceFile[]): void {
  let total = 0;
  const seen = new Set<string>();
  for (const f of files) {
    if (!f.filename || /[\\/]/.test(f.filename)) {
      throw new EvidenceValidationError(`Evidence filename must be a bare file name: "${f.filename}"`);
    }
    if (seen.has(f.filename)) throw new EvidenceValidationError(`Duplicate evidence filename: ${f.filename}`);
    seen.add(f.filename);

    const allowed = EXTENSIONS[f.contentType];
    if (!allowed)
      throw new EvidenceFileTypeError(`Unsupported evidence type ${String(f.contentType)}: ${f.filename}`);
    if (!allowed.some((ext) => f.filename.toLowerCase().endsWith(ext))) {
      throw new EvidenceFileTypeError(`${f.filename} does not have a ${allowed.join("/")} extension`);
    }
    const magic = MAGIC[f.contentType];
    if (f.data.byteLength < magic.length || magic.some((b, i) => f.data[i] !== b)) {
      throw new EvidenceFileTypeError(`${f.filename} is not a valid ${f.contentType} file`);
    }
    if (f.data.byteLength > MAX_FILE_BYTES) {
      throw new EvidenceTooLargeError(
        `${f.filename} is ${mb(f.data.byteLength)}MB; PayPal allows ${mb(MAX_FILE_BYTES)}MB per file`,
      );
    }
    total += f.data.byteLength;
  }
  if (total > MAX_TOTAL_BYTES) {
    throw new EvidenceTooLargeError(`Evidence totals ${mb(total)}MB; PayPal allows ${mb(MAX_TOTAL_BYTES)}MB`);
  }
}

/** Every `documents[].name` must refer to an uploaded file. */
export function assertDocumentsMatchFiles(
  documentNames: readonly string[],
  files: readonly EvidenceFile[],
): void {
  const names = new Set(files.map((f) => f.filename));
  const missing = documentNames.filter((n) => !names.has(n));
  if (missing.length)
    throw new EvidenceValidationError(`Documents without an uploaded file: ${missing.join(", ")}`);
}

/**
 * multipart/form-data body with a JSON part named `input` plus one part per file.
 * Part names follow the Disputes v1 spec; confirm them on the first live sandbox call.
 */
export function buildMultipart(
  input: unknown,
  files: readonly EvidenceFile[],
  filePartName: string,
): FormData {
  validateEvidenceFiles(files);
  const form = new FormData();
  form.append("input", new Blob([JSON.stringify(input)], { type: "application/json" }));
  for (const f of files) {
    form.append(filePartName, new Blob([new Uint8Array(f.data)], { type: f.contentType }), f.filename);
  }
  return form;
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "");
}
