# packages/agent (B)

Claude agents. None of them act: they read, advise and draft.

- Model ids and prices live only in `models.ts` (`claude-opus-5-5` reasoning/drafting, `claude-haiku-5-5` classification).
- Every call goes through `runStructured` (`llm.ts`): read-only tool loop, `output_config.format` JSON validated with zod, one corrective turn, refusal/truncation errors, prompt caching, `Budget` spend cap, usage per call.
- Agents: `triage.ts`, `narrative.ts` (claims must cite known exhibits; identifiers and amounts must be in the cited data), `buyer-message.ts`, `appeal.ts`, `classify.ts`. Each has a deterministic template fallback; nothing requires an API key.
- Buyer/dispute text is untrusted: wrap it with `fence()` and keep `UNTRUSTED_RULES` in every system prompt. Never give an agent a write tool.
- Tests use a scripted fake `LlmClient`; they never call the API.
