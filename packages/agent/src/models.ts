// The one place model ids live (CLAUDE.md). Opus reasons and drafts; Haiku classifies.
export const MODELS = {
  reasoning: "claude-opus-5-5",
  extraction: "claude-haiku-5-5",
} as const;
export type ModelRole = keyof typeof MODELS;

/** Most a single case may spend on Claude (triage + narrative + drafts) before falling back to templates. */
export const MAX_COST_PER_CASE_USD = 0.75;

/** USD per million tokens (Anthropic first-party pricing, cached 2026-10). */
export const PRICES: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  // Possible server-side fallback targets for Opus refusals.
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
};

export function costUsd(
  model: string,
  u: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number },
  fallbackModel: string = MODELS.reasoning,
): number {
  const p = PRICES[model] ?? PRICES[fallbackModel]!;
  return (
    (u.inputTokens * p.input +
      u.outputTokens * p.output +
      u.cacheReadTokens * p.cacheRead +
      u.cacheWriteTokens * p.cacheWrite) /
    1_000_000
  );
}
