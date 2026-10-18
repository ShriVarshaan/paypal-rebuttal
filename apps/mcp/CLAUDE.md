# apps/mcp (B, stretch)

Stdio MCP server for Claude Desktop over the api's REST routes. Tool logic is in `src/tools.ts` (tested with a fake api); `src/main.ts` only registers tools. Approval must stay two-step (`confirm: true`), and tool output must not include raw buyer text.
