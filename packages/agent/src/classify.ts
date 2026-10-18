import type { AgentUsage } from "@rebuttal/core";
import { z } from "zod";
import { AgentError, runStructured, type Budget, type LlmClient } from "./llm.js";
import { fence, UNTRUSTED_RULES } from "./untrusted.js";

/**
 * Per-message labels for the buyer's side of the thread (Haiku; role doc Day 6). Shown in
 * the UI and to the triage agent as context. They never feed p_win directly: only the
 * triage agent's cited, bounded nudge can do that.
 */
export const MessageLabel = z.enum([
  "admits_receipt",
  "complaint_specific",
  "threatening",
  "asks_refund",
  "neutral",
]);
export type MessageLabel = z.infer<typeof MessageLabel>;

const Output = z.object({
  messages: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        label: MessageLabel,
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(50),
  injectionSuspected: z.boolean(),
});
export type MessageClassification = z.infer<typeof Output>;

export async function classifyMessages(
  llm: LlmClient,
  texts: string[],
  opts: { budget?: Budget } = {},
): Promise<{ result: MessageClassification; usage: AgentUsage[] }> {
  const numbered = texts.map((t, i) => `[${i}] ${t.slice(0, 2000)}`).join("\n");
  const { output, usage } = await runStructured(llm, {
    agent: "classify",
    role: "extraction",
    system: `Label each of a buyer's messages about a disputed online order with one of: admits_receipt (says they received the item), complaint_specific (a concrete problem with the item or delivery), threatening (threats or abuse), asks_refund (asks for money back), neutral. Give your confidence from 0 to 1. Use the [n] index of each message.\n\n${UNTRUSTED_RULES}`,
    prompt: `${fence("buyer_messages", numbered)}\n\nReturn the labels JSON.`,
    schema: Output,
    effort: "low",
    maxTokens: 4000,
    ...(opts.budget ? { budget: opts.budget } : {}),
  });
  // Keep one label per known message index.
  const seen = new Set<number>();
  const messages = output.messages.filter(
    (m) => m.index < texts.length && !seen.has(m.index) && (seen.add(m.index), true),
  );
  return { result: { ...output, messages }, usage };
}

/** Adapter for the messages connector: labels per text, or null when Claude is unavailable. */
export function messageClassifier(llm: LlmClient | null) {
  if (!llm) return undefined;
  return async (texts: string[]) => {
    try {
      const { result } = await classifyMessages(llm, texts);
      return texts.map((_, i) => result.messages.find((m) => m.index === i) ?? null);
    } catch (err) {
      if (err instanceof AgentError) return null;
      throw err;
    }
  };
}
