import type { Deps } from "../deps.js";
import { QUEUES } from "../queues.js";

export const POLL_CURSOR = "dispute.poll.lastRunAt";
const OVERLAP_MS = 5 * 60 * 1000;

/**
 * dispute.poll (cron, every minute): the backstop for missed webhooks. Lists disputes
 * updated since the last run minus 5 minutes and enqueues a sync for each.
 * `update_time_after` (not `start_time`) so changes to old disputes are caught too.
 */
export async function pollDisputes(deps: Deps): Promise<{ enqueued: number }> {
  const startedAt = deps.now();
  const cursor = await deps.db.syncCursor.findUnique({ where: { key: POLL_CURSOR } });
  const since = cursor ? new Date(Date.parse(cursor.value) - OVERLAP_MS).toISOString() : undefined;

  let enqueued = 0;
  for await (const d of deps.paypal.disputes.listAll(since ? { update_time_after: since } : {})) {
    await deps.queue.send(QUEUES.disputeSync, { disputeId: d.dispute_id }, { singletonKey: d.dispute_id });
    enqueued++;
  }

  // Only advance the cursor after a complete pass, so a failed page is retried next minute.
  await deps.db.syncCursor.upsert({
    where: { key: POLL_CURSOR },
    create: { key: POLL_CURSOR, value: startedAt.toISOString() },
    update: { value: startedAt.toISOString() },
  });
  if (enqueued) deps.log.info({ enqueued, since: since ?? null }, "poll enqueued syncs");
  return { enqueued };
}
