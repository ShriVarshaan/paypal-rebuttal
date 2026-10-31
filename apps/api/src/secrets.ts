import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

/**
 * CREDENTIALS_KEY: 32 bytes as base64 or hex. Generate one with
 * `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
 */
export function credentialsKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = env["CREDENTIALS_KEY"]?.trim();
  if (!raw) return null;
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("CREDENTIALS_KEY must be 32 bytes (base64 or 64 hex characters)");
  return key;
}

/** AES-256-GCM with a random 96-bit IV. Output: "v1:" + base64(iv | tag | ciphertext). */
export function sealSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64")}`;
}

/** Throws if the key is wrong or the ciphertext was altered (GCM authentication). */
export function openSecret(sealed: string, key: Buffer): string {
  const [version, body] = sealed.split(":", 2);
  if (version !== VERSION || !body) throw new Error("unknown secret format");
  const buf = Buffer.from(body, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

/** "AbCd…wxyz" so the seller can recognise a stored id without it being shown in full. */
export function maskId(id: string): string {
  return id.length <= 8 ? "••••" : `${id.slice(0, 4)}…${id.slice(-4)}`;
}
