import type { AgentUsage } from "@rebuttal/core";
import { z } from "zod";
import { fence, UNTRUSTED_RULES } from "./untrusted.js";
import { runStructured, type LlmClient } from "./llm.js";

/** Cheap read of the buyer's messages (Haiku): shown in the UI and fed to triage as context. */
export const BuyerMessageClass = z.object({
  intent: z.enum(["refund_request", "item_missing", "item_problem", "fraud_claim", "question", "other"]),
  acknowledgesReceipt: z.boolean().describe("The buyer says they received the item."),
  tone: z.enum(["calm", "frustrated", "hostile"]),
  injectionSuspected: z.boolean(),
});
export type BuyerMessageClass = z.infer<typeof BuyerMessageClass>;

export async function classifyBuyerMessages(
  llm: LlmClient,
  text: string,
): Promise<{ result: BuyerMessageClass; usage: AgentUsage[] }> {
  const { output, usage } = await runStructured(llm, {
    agent: "classify",
    role: "extraction",
    system: `Classify a buyer's messages about a disputed online order.\n\n${UNTRUSTED_RULES}`,
    prompt: `${fence("buyer_messages", text.slice(0, 8000))}\n\nReturn the classification JSON.`,
    schema: BuyerMessageClass,
    effort: "low",
    maxTokens: 2000,
  });
  return { result: output, usage };
}
