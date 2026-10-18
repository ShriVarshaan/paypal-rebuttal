import type { JobWithMetadata, PgBoss } from "pg-boss";
import type { z } from "zod";
import { PermanentJobError, type Deps } from "./deps.js";
import { enrichCase } from "./jobs/enrich.js";
import { executeDecision, onPackReady } from "./jobs/execute.js";
import { gatherEvidence } from "./jobs/gather.js";
import { pollDisputes } from "./jobs/poll.js";
import { fireSla } from "./jobs/sla.js";
import { syncDispute } from "./jobs/sync.js";
import { Payloads, QUEUES, ensureQueues, type QueueName } from "./queues.js";

export interface WorkerOptions {
  /** Cron for dispute.poll; false disables polling. Default every minute. */
  pollCron?: string | false;
  pollingIntervalSeconds?: number;
}

/** Registers every job handler A owns. B and C register case.triage and their pack job. */
export async function startWorker(boss: PgBoss, deps: Deps, opts: WorkerOptions = {}): Promise<void> {
  await ensureQueues(boss);

  const handle = async <N extends QueueName>(
    name: N,
    fn: (data: z.infer<(typeof Payloads)[N]>, job: JobWithMetadata<unknown>) => Promise<unknown>,
  ) => {
    await boss.work(
      name,
      { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: opts.pollingIntervalSeconds ?? 1 },
      async (jobs) => {
        for (const job of jobs) {
          const started = Date.now();
          try {
            // Cron-created jobs carry `data: null`.
            const data = Payloads[name].parse(job.data ?? {}) as z.infer<(typeof Payloads)[N]>;
            const result = await fn(data, job);
            deps.log.debug(
              { queue: name, jobId: job.id, durationMs: Date.now() - started, result },
              "job done",
            );
          } catch (err) {
            // Retrying can't fix these; finish the job so pg-boss stops retrying it.
            if (err instanceof PermanentJobError || (err as { name?: string }).name === "ZodError") {
              deps.log.error(
                { queue: name, jobId: job.id, err: (err as Error).message },
                "job failed permanently",
              );
              continue;
            }
            deps.log.warn(
              { queue: name, jobId: job.id, retryCount: job.retryCount, err: (err as Error).message },
              "job failed; will retry",
            );
            throw err;
          }
        }
      },
    );
  };

  await handle(QUEUES.disputeSync, (d) => syncDispute(deps, d.disputeId));
  await handle(QUEUES.disputePoll, () => pollDisputes(deps));
  await handle(QUEUES.caseEnrich, (d) => enrichCase(deps, d.caseId));
  await handle(QUEUES.caseGather, (d) => gatherEvidence(deps, d.caseId));
  await handle(QUEUES.actionExecute, (d, job) =>
    executeDecision(deps, d.decisionId, { retryCount: job.retryCount, retryLimit: job.retryLimit }),
  );
  await handle(QUEUES.packReady, (d) =>
    onPackReady(deps, d.packId, (decisionId) =>
      deps.queue.send(QUEUES.actionExecute, { decisionId }, { singletonKey: decisionId }),
    ),
  );
  await handle(QUEUES.slaFire, (d) => fireSla(deps, d.slaJobId));

  if (opts.pollCron !== false) await boss.schedule(QUEUES.disputePoll, opts.pollCron ?? "* * * * *", {});
  else await boss.unschedule(QUEUES.disputePoll).catch(() => {});
}
