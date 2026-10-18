import type { PayPalConfig } from "./config.js";

/** Raw read access to disputes; responses are validated by the caller. */
export interface DisputesReader {
  readonly name: string;
  list(params: ToolkitListParams): Promise<unknown>;
  show(disputeId: string): Promise<unknown>;
}

/** The only list filters the toolkit's `list_disputes` tool accepts (v1.11). */
export interface ToolkitListParams {
  page_size?: number;
  dispute_state?: string;
  disputed_transaction_id?: string;
}
export const TOOLKIT_LIST_PARAM_KEYS: readonly string[] = [
  "page_size",
  "dispute_state",
  "disputed_transaction_id",
];

interface ExecutableTool {
  execute?: (args: unknown, options: { toolCallId: string; messages: unknown[] }) => Promise<unknown>;
}

/**
 * `list_disputes` / `get_dispute` through `@paypal/agent-toolkit`, the same tools the
 * agents call. Loaded lazily because the toolkit pulls in the AI SDK and LangChain.
 */
export function toolkitReader(config: PayPalConfig): DisputesReader {
  let tools: Promise<Record<string, ExecutableTool>> | undefined;

  const load = () =>
    (tools ??= import("@paypal/agent-toolkit/ai-sdk").then((mod) => {
      // CommonJS bundle: the class may sit on the default export.
      const ns = mod as unknown as {
        PayPalAgentToolkit?: unknown;
        default?: { PayPalAgentToolkit?: unknown };
      };
      const Toolkit = (ns.PayPalAgentToolkit ?? ns.default?.PayPalAgentToolkit) as new (opts: unknown) => {
        getTools(): Record<string, ExecutableTool>;
      };
      const toolkit = new Toolkit({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        configuration: {
          actions: { disputes: { list: true, get: true } },
          context: { sandbox: true },
        },
      });
      return toolkit.getTools();
    }));

  const run = async (tool: string, args: unknown): Promise<unknown> => {
    const t = (await load())[tool];
    if (!t?.execute) throw new Error(`Agent toolkit has no executable tool ${tool}`);
    return t.execute(args, { toolCallId: `rebuttal-${tool}`, messages: [] });
  };

  return {
    name: "agent-toolkit",
    list: (params) => run("list_disputes", params),
    show: (disputeId) => run("get_dispute", { dispute_id: disputeId }),
  };
}
