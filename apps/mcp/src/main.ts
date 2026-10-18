// Rebuttal MCP server (plan §1.12, stretch): ask "what's open and what should I do?" from
// Claude Desktop. Talks to the api over REST (API_URL, API_TOKEN); stdio transport.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { approveDecision, explainDecision, httpApi, listOpenCases } from "./tools.js";

const api = httpApi({
  baseUrl: process.env["API_URL"] ?? "http://localhost:3001",
  ...(process.env["API_TOKEN"] ? { token: process.env["API_TOKEN"] } : {}),
});
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

const server = new McpServer({ name: "rebuttal", version: "0.1.0" });

server.registerTool(
  "list_open_cases",
  {
    title: "List open disputes",
    description: "Open PayPal disputes with reason, amount, state and deadline, soonest deadline first.",
    annotations: { readOnlyHint: true },
  },
  async () => text(await listOpenCases(api)),
);

server.registerTool(
  "explain_decision",
  {
    title: "Explain a decision",
    description:
      "Why Rebuttal recommends fighting, offering or accepting on a case: p_win, expected values, evidence gaps.",
    inputSchema: { caseId: z.string().describe("Case id from list_open_cases") },
    annotations: { readOnlyHint: true },
  },
  async ({ caseId }) => text(await explainDecision(api, caseId)),
);

server.registerTool(
  "approve_decision",
  {
    title: "Approve a decision",
    description:
      "Approve a PROPOSED decision so Rebuttal files it with PayPal. Call once without confirm to see what will be filed, ask the seller, then call again with confirm: true.",
    inputSchema: {
      caseId: z.string(),
      decisionId: z.string(),
      confirm: z.boolean().optional().describe("true only after the seller has confirmed"),
    },
    annotations: { destructiveHint: true, idempotentHint: true },
  },
  async ({ caseId, decisionId, confirm }) =>
    text(await approveDecision(api, { caseId, decisionId, ...(confirm !== undefined ? { confirm } : {}) })),
);

await server.connect(new StdioServerTransport());
