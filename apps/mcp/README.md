# Rebuttal MCP server

Ask Claude Desktop "what's open and what should I do?" (plan §1.12, stretch). Three tools, all over the api's REST routes:

| Tool | What it does |
|---|---|
| `list_open_cases` | Open disputes with reason, amount, state and deadline |
| `explain_decision(caseId)` | Why the engine chose fight / offer / accept: p_win, EVs, evidence gaps, autonomy |
| `approve_decision(caseId, decisionId, confirm?)` | Approves a PROPOSED decision. Without `confirm: true` it only says what would be filed |

`explain_decision` leaves the buyer's own words out of its answer, since that text goes into another model's context.

Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "rebuttal": {
      "command": "pnpm",
      "args": ["--dir", "/path/to/paypal-rebuttal", "--filter", "@rebuttal/mcp", "start"],
      "env": { "API_URL": "http://localhost:3001", "API_TOKEN": "<same as the api>" }
    }
  }
}
```
