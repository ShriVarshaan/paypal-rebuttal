import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { AgentUsage } from "@rebuttal/core";
import { z } from "zod";
import { costUsd, MODELS, type ModelRole } from "./models.js";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;
type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;

/** The one Claude call the agents make. Tests pass a scripted fake. */
export interface LlmClient {
  create(params: Params): Promise<Message>;
}

export function anthropicLlm(opts: { apiKey?: string; maxRetries?: number } = {}): LlmClient {
  const client = new Anthropic({
    maxRetries: opts.maxRetries ?? 3,
    ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
  });
  return { create: (params) => client.beta.messages.create(params) };
}

/** A real client when ANTHROPIC_API_KEY is set and agents aren't switched off; otherwise templates. */
export function llmFromEnv(env: NodeJS.ProcessEnv = process.env): LlmClient | null {
  if (env["AGENTS_DISABLED"] === "1" || !env["ANTHROPIC_API_KEY"]) return null;
  return anthropicLlm({ apiKey: env["ANTHROPIC_API_KEY"] });
}

export class AgentError extends Error {
  override readonly name = "AgentError";
  /** Calls already made (and paid for) before the failure. */
  constructor(
    message: string,
    readonly usage: AgentUsage[] = [],
  ) {
    super(message);
  }
}

/** A spend cap shared by every call it is passed to (per case in the worker, per run in the eval). */
export class Budget {
  spentUsd = 0;
  constructor(readonly limitUsd: number) {}
  get exhausted(): boolean {
    return this.spentUsd >= this.limitUsd;
  }
}

/** A read-only tool the model may call. Inputs are validated before `run`. */
export interface AgentTool {
  name: string;
  description: string;
  input: z.ZodObject;
  run(input: Record<string, unknown>): unknown;
}

export interface StructuredCall<T> {
  agent: string;
  role: ModelRole;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  tools?: AgentTool[];
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  /** Tool-use round trips before giving up. */
  maxTurns?: number;
  budget?: Budget;
}

export interface StructuredResult<T> {
  output: T;
  usage: AgentUsage[];
}

function toolDef(t: AgentTool, last: boolean): Anthropic.Beta.Messages.BetaTool {
  const schema = z.toJSONSchema(t.input) as Record<string, unknown>;
  return {
    name: t.name,
    description: t.description,
    input_schema: {
      type: "object",
      properties: (schema["properties"] ?? {}) as Record<string, unknown>,
      required: (schema["required"] ?? []) as string[],
    },
    // Cache breakpoint after the tool list: tools + system are the same on every turn.
    ...(last ? { cache_control: { type: "ephemeral" as const } } : {}),
  };
}

function runTool(tools: AgentTool[], name: string, input: unknown): { content: string; isError: boolean } {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { content: `Unknown tool ${name}`, isError: true };
  const parsed = tool.input.safeParse(input ?? {});
  if (!parsed.success) return { content: `Invalid input: ${parsed.error.message}`, isError: true };
  try {
    const out = tool.run(parsed.data as Record<string, unknown>);
    return { content: typeof out === "string" ? out : JSON.stringify(out), isError: false };
  } catch (err) {
    return { content: `Tool failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}

/**
 * One agent run: an optional read-only tool loop, ending in JSON constrained by
 * `output_config.format` and validated with zod. A validation failure gets one corrective
 * turn; anything else (refusal, truncation, repeated bad output) throws AgentError and the
 * caller falls back to its template.
 */
export async function runStructured<T>(
  llm: LlmClient,
  call: StructuredCall<T>,
): Promise<StructuredResult<T>> {
  const model = MODELS[call.role];
  const tools = call.tools ?? [];
  const usage: AgentUsage[] = [];
  const messages: MessageParam[] = [{ role: "user", content: call.prompt }];
  const { parse: _parse, ...format } = zodOutputFormat(call.schema as z.ZodType);
  let corrections = 0;

  const fail = (msg: string) => new AgentError(`${call.agent}: ${msg}`, usage);

  for (let turn = 0; turn < (call.maxTurns ?? 6) + 2; turn++) {
    if (call.budget?.exhausted) throw fail(`budget of ${call.budget.limitUsd} exhausted`);
    const started = Date.now();
    const res = await llm.create({
      model,
      max_tokens: call.maxTokens ?? 16000,
      system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
      messages,
      ...(tools.length ? { tools: tools.map((t, i) => toolDef(t, i === tools.length - 1)) } : {}),
      output_config: { effort: call.effort ?? "medium", format },
      // Opus: if a safety classifier declines, the API retries on its default fallback model.
      ...(call.role === "reasoning"
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
    });
    const u = {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
    };
    usage.push({
      agent: call.agent,
      model: res.model,
      ...u,
      costUsd: costUsd(res.model, u, model),
      latencyMs: Date.now() - started,
    });
    if (call.budget) call.budget.spentUsd += usage.at(-1)!.costUsd;

    if (res.stop_reason === "refusal")
      throw fail(`model declined (${res.stop_details?.category ?? "unknown"})`);
    if (res.stop_reason === "max_tokens") throw fail("output truncated at max_tokens");

    const toolUses = res.content.filter(
      (b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use",
    );
    if (res.stop_reason === "tool_use" && toolUses.length) {
      if (turn >= (call.maxTurns ?? 6)) throw fail("too many tool calls");
      messages.push({ role: "assistant", content: res.content });
      const results: ToolResult[] = toolUses.map((b) => {
        const r = runTool(tools, b.name, b.input);
        return {
          type: "tool_result",
          tool_use_id: b.id,
          content: r.content,
          ...(r.isError ? { is_error: true } : {}),
        };
      });
      messages.push({ role: "user", content: results });
      continue;
    }

    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let problem: string;
    try {
      const parsed = call.schema.safeParse(JSON.parse(text));
      if (parsed.success) return { output: parsed.data, usage };
      problem = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
    } catch {
      problem = "response was not valid JSON";
    }
    if (corrections++ >= 1) throw fail(`invalid output (${problem})`);
    messages.push({ role: "assistant", content: res.content });
    messages.push({
      role: "user",
      content: `That output failed validation: ${problem}. Return the corrected JSON only.`,
    });
  }
  throw fail("no final answer");
}
