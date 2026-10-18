import type { EvidenceFile } from "../multipart.js";

/** A minimal valid-looking PDF of `bytes` length. */
export function pdf(name: string, bytes = 1024): EvidenceFile {
  const data = new Uint8Array(bytes);
  data.set(Buffer.from("%PDF-1.7\n"));
  return { filename: name, contentType: "application/pdf", data };
}
