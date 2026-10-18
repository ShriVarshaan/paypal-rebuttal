import { EvidenceItem } from "@rebuttal/core";
import { json, toConnectorCase } from "../case-row.js";
import { PermanentJobError, type Deps } from "../deps.js";
import { QUEUES } from "../queues.js";

/**
 * case.gather: run every connector that supports the Case and upsert what they return.
 * One connector failing never stops the others; failures are recorded on the event.
 */
export async function gatherEvidence(
  deps: Deps,
  caseId: string,
): Promise<{ stored: number; failures: string[] }> {
  const row = await deps.db.case.findUnique({ where: { id: caseId } });
  if (!row) throw new PermanentJobError(`Case ${caseId} not found`);
  const c = toConnectorCase(row);

  const results = await Promise.all(
    deps.sources.map(async (source) => {
      try {
        if (!source.supports(c)) return { source: source.id, items: [] as EvidenceItem[], skipped: true };
        const items = (await source.gather(c)).map((i) => EvidenceItem.parse(i));
        return { source: source.id, items, skipped: false };
      } catch (err) {
        deps.log.warn(
          { caseId, source: source.id, err: err instanceof Error ? err.message : String(err) },
          "connector failed",
        );
        return {
          source: source.id,
          items: [] as EvidenceItem[],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  let stored = 0;
  for (const r of results) {
    for (const item of r.items) {
      const data = {
        type: item.type,
        title: item.title,
        data: json(item.data),
        filePath: item.filePath ?? null,
        capturedAt: new Date(item.capturedAt),
      };
      await deps.db.evidenceItem.upsert({
        where: { caseId_source_dedupeKey: { caseId, source: item.source, dedupeKey: item.dedupeKey } },
        create: { caseId, source: item.source, dedupeKey: item.dedupeKey, ...data },
        update: data,
      });
      stored++;
    }
  }
  const failures = results.flatMap((r) => ("error" in r && r.error ? [`${r.source}: ${r.error}`] : []));
  await deps.db.caseEvent.create({
    data: {
      caseId,
      type: "EVIDENCE_GATHERED",
      payload: json({
        sources: Object.fromEntries(
          results.filter((r) => !r.skipped && !("error" in r)).map((r) => [r.source, r.items.length]),
        ),
        failures,
      }),
    },
  });
  await deps.queue.send(QUEUES.caseTriage, { caseId }, { singletonKey: caseId });
  return { stored, failures };
}
