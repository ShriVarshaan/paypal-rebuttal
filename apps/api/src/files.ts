import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { FastifyReply } from "fastify";

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/**
 * Streams a stored evidence or pack file, but only if it resolves (after symlinks) to a
 * regular file inside `root`. Paths come from the database, never from the request.
 */
export async function sendStoredFile(
  reply: FastifyReply,
  root: string,
  storedPath: string,
  opts: { downloadName?: string } = {},
) {
  const realRoot = await realpath(resolve(root)).catch(() => null);
  if (!realRoot) return reply.code(404).send({ error: "evidence storage unavailable" });
  const target = await realpath(isAbsolute(storedPath) ? storedPath : resolve(realRoot, storedPath)).catch(
    () => null,
  );
  if (!target) return reply.code(404).send({ error: "file unavailable" });
  const rel = relative(realRoot, target);
  if (rel.startsWith("..") || isAbsolute(rel)) return reply.code(403).send({ error: "file outside storage" });
  const info = await stat(target);
  if (!info.isFile()) return reply.code(404).send({ error: "file unavailable" });
  const contentType = CONTENT_TYPES[extname(target).toLowerCase()];
  if (!contentType) return reply.code(415).send({ error: "unsupported media" });
  if (opts.downloadName)
    reply.header("content-disposition", `inline; filename="${opts.downloadName.replace(/[^\w.-]/g, "_")}"`);
  return reply
    .type(contentType)
    .header("cache-control", "private, no-store")
    .header("content-length", String(info.size))
    .send(createReadStream(target));
}
