import type { PgBoss } from "pg-boss";
import { z } from "zod";

/** Every job queue. Payload schemas are checked when a job is picked up. */
export const QUEUES = {
  disputeSync: "dispute.sync",
  disputePoll: "dispute.poll",
  caseEnrich: "case.enrich",
  caseGather: "case.gather",
  /** B: triage → Decision (jobs/triage.ts). Sent after gathering. */
  caseTriage: "case.triage",
  /** B: draft an appeal when a case is LOST (jobs/appeal.ts). */
  caseAppeal: "case.appeal",
  actionExecute: "action.execute",
  /** Sent by C's pack job when an EvidencePack is READY. */
  packReady: "pack.ready",
  slaFire: "sla.fire",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const Payloads = {
  [QUEUES.disputeSync]: z.object({ disputeId: z.string() }),
  [QUEUES.disputePoll]: z.object({}).loose(),
  [QUEUES.caseEnrich]: z.object({ caseId: z.string() }),
  [QUEUES.caseGather]: z.object({ caseId: z.string() }),
  [QUEUES.caseTriage]: z.object({ caseId: z.string() }),
  [QUEUES.caseAppeal]: z.object({ caseId: z.string() }),
  [QUEUES.actionExecute]: z.object({ decisionId: z.string() }),
  [QUEUES.packReady]: z.object({ packId: z.string() }),
  [QUEUES.slaFire]: z.object({ slaJobId: z.string() }),
} satisfies Record<QueueName, z.ZodType>;

type QueueConfig = Parameters<PgBoss["createQueue"]>[1];

/**
 * `stately` + singletonKey = at most one queued and one active job per key, so the same
 * dispute never syncs twice at once and a decision never executes twice in parallel.
 */
export const QUEUE_CONFIG: Record<QueueName, QueueConfig> = {
  [QUEUES.disputeSync]: {
    policy: "stately",
    retryLimit: 5,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 120,
  },
  [QUEUES.disputePoll]: { policy: "singleton", retryLimit: 0, expireInSeconds: 300 },
  [QUEUES.caseEnrich]: { policy: "stately", retryLimit: 5, retryDelay: 5, retryBackoff: true },
  [QUEUES.caseGather]: { policy: "stately", retryLimit: 3, retryDelay: 10, retryBackoff: true },
  [QUEUES.caseTriage]: { policy: "stately", retryLimit: 3, retryDelay: 10, retryBackoff: true },
  [QUEUES.caseAppeal]: { policy: "stately", retryLimit: 3, retryDelay: 30, retryBackoff: true },
  [QUEUES.actionExecute]: {
    policy: "stately",
    retryLimit: 6,
    retryDelay: 5,
    retryBackoff: true,
    retryDelayMax: 300,
    expireInSeconds: 300,
  },
  [QUEUES.packReady]: { policy: "standard", retryLimit: 3 },
  [QUEUES.slaFire]: { policy: "standard", retryLimit: 5, retryDelay: 30 },
};

export interface SendOptions {
  singletonKey?: string;
  startAfter?: Date;
}

/** The slice of pg-boss the jobs use, so tests can swap in a recorder. */
export interface JobQueue {
  send(name: QueueName, data: object, options?: SendOptions): Promise<string | null>;
  cancel(name: QueueName, id: string): Promise<void>;
}

export function pgBossQueue(boss: PgBoss): JobQueue {
  return {
    send: (name, data, options = {}) =>
      boss.send(name, data, {
        ...(options.singletonKey ? { singletonKey: options.singletonKey } : {}),
        ...(options.startAfter ? { startAfter: options.startAfter } : {}),
      }),
    async cancel(name, id) {
      await boss.cancel(name, id);
    },
  };
}

/** Creates missing queues and brings existing ones in line with QUEUE_CONFIG. */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const [name, config] of Object.entries(QUEUE_CONFIG)) {
    if (await boss.getQueue(name)) {
      const { policy: _policy, ...updatable } = config ?? {};
      await boss.updateQueue(name, updatable);
    } else {
      await boss.createQueue(name, config);
    }
  }
}
