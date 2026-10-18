# Log: B (Intelligence & Decisions)

What Claude Code did well and badly while building B's part (plan §4). Material for the writeup's Claude Code section.

## 2026-10-18: B's whole plan in one session

Built on A's `a/platform-backup` branch, in the branch `b/intelligence-decisions`. The order was: core contract additions → decision engine → connectors → agents → worker/api integration → eval → role-doc alignment → MCP server → docs.

**Went well**
- Reading A's platform first (worker jobs, executor, SLA, test harness) meant B's jobs plugged into existing seams (`Deps`, `case.triage` queue, `Decision` rows, `pack.ready`) instead of inventing new ones. The simulator e2e now runs the real triage decision instead of a stub.
- The eval paid for itself. It surfaced that the win model ignored explicit fraud signals (case H14), which led to the `fraud_signals` feature. It also showed that "recovered dollars" from one outcome per case is too noisy to rank strategies, so the report leads with expected value and regret.
- Integration testing found bugs outside B's code:
  - the offline EasyPost stand-in reported no delivery location, so "delivered to the address on file" could never be true in simulator mode;
  - the embedded Postgres used WIN1252 on Windows and rejected non-Latin-1 text;
  - the SLA forced decision treated FILING (waiting for the PDF pack) as already answered, so an approved FIGHT could miss its deadline;
  - the e2e test raced the SLA cancellation under parallel load.

**Went badly / watch for**
- The first pass followed `docs/plan.md` and missed `docs/roles/person-b-intelligence.md`, which is more specific: three evidence tiers, the case format, coverage counts, the injection set, AgentRun logging. A second pass realigned everything. Read the role doc first.
- Shell one-liners that edited TypeScript (`node -e` / heredocs inside bash) mangled template literals and `\n` escapes several times. One failed command chain deleted an uncommitted file, which had to be recreated from the session. Use real script files or the editor for multi-line edits, and never chain a destructive step after `;`.
- `prettier --write <dir>` reformatted teammates' files (tsconfigs). Format only the files you touched.
- First calibration attempt overfit (train log-loss 0.46 → 0.24, held-out no better). The fix was choosing λ by cross-validation inside the train split. Fixed-λ gradient descent also diverged for huge λ until the penalty became a proximal step.

**Open items for humans**
- Run the sandbox runbook for real and fill in its timings.
- Run the blind labeling round (`pnpm eval:label <name>`), then `pnpm eval:agreement`.
- Run `pnpm eval --llm` with a key for the Claude-only and hybrid ablation rows.
- Review the matrix tiers, `weights.v0.json` and the policy defaults: these are judgement calls, not facts.
- The `packages/core` additions need A and C's approval (CLAUDE.md rule) before merging.
