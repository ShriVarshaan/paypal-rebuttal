# Contributing to Rebuttal

## Setup
1. Accept the GitHub collaborator invite.
2. `git clone https://github.com/ShriVarshaan/rebuttal.git && cd rebuttal`
3. Copy `.env.example` to `.env` and fill in your own PayPal **sandbox** credentials (never commit `.env`).
4. Open Claude Code in the repo root — it reads `CLAUDE.md` automatically.

## Branches
- `main` is always runnable. No direct pushes; everything goes through a PR.
- Branch names: `<role>/<short-topic>`, e.g. `a/webhooks`, `b/ev-engine`, `c/case-queue`.
- Parallel work in one checkout: `git worktree add ../rebuttal-<topic> -b <role>/<topic>`.

## Daily flow
1. `git pull --rebase origin main` before you start.
2. Work with Claude Code on your branch; commit small and often.
3. Before opening a PR, run `/code-review` in Claude Code and fix what it finds.
4. Open the PR, fill in the template, request a review from one teammate.
5. Merge to `main` by end of day (squash merge). Keep PRs under ~400 lines when possible.

## Rules
- `packages/core` (shared types/contracts) changes need approval from **all three** people.
- Never commit secrets, real customer data, or live (non-sandbox) PayPal credentials.
- Log what Claude Code did well/badly in `docs/log/<your-name>.md` — it goes into the submission writeup.
