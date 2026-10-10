# Contributing

This project is co-created by 3-6 humans, each working with their own AI coding assistant.
Because of that, **process discipline matters more than speed**. Read this file before your first commit.

## 1. Read before you code (mandatory)

1. `AGENTS.md` - the entry point for AI assistants (read order + hard bans)
2. `docs/PROJECT_GUIDE.md` - the single source of truth for product rules
3. `docs/CONTRACTS.md` - API / table / event contracts
4. `docs/ai-logs/OWNERS.md` - who is working on which module right now
5. The 5 most recent files in `docs/ai-logs/ops/`

If a module is marked `杩涜涓璥 by someone else, **do not touch it**. Pick another module or talk to them first.

## 2. The ten-step loop

```
read -> check -> claim -> contract -> implement -> self-test
     -> write ops log -> write report -> update INDEX -> open a PR
```

Steps 7-9 are **not optional**. Even a blocked round must leave a log explaining where you got stuck.

## 3. Branches and commits

Branch names:

| Prefix | Meaning | Example |
|---|---|---|
| `feat/<module>` | new feature | `feat/scoring-settle` |
| `fix/<module>` | bug fix | `fix/media-expire-cron` |
| `docs/` | documentation only | `docs/guide-v1.3` |
| `refactor/` | no behaviour change | `refactor/points-ledger` |
| `chore/` | tooling / deps / CI | `chore/ci-setup` |

Commit messages **must carry the requirement IDs** from PROJECT_GUIDE so future AI sessions can trace rules back:

```
feat(scoring): implement settle() three branches (E1-E4)
fix(media): expire proof media after 72h (D8, D9)
docs(guide): clarify points summary identity (F5)
```

Never commit directly to `main`. Never force-push a shared branch.

## 4. Pull requests

Every PR description must contain:

- the module name and the requirement IDs it implements
- a link to this round's ops log and report
- how a reviewer can verify it by hand
- a clearly marked **breaking changes** section (empty is fine, but write it)

Every PR needs at least one human reviewer, who **checks the ops log against the diff**.
A log that says "3 files changed" and a diff with 8 files is a rejected PR.

## 5. Shared files (serialize your edits)

These are touched by everyone. Announce in your ops log before changing them, and update
`docs/CONTRACTS.md` in the same round:

`packages/shared/src/types/**` - `apps/api/prisma/schema.prisma` (+ migrations) -
`apps/api/src/routes/index.ts` - `packages/shared/src/constants.ts` -
`docs/CONTRACTS.md` - `package.json` / `pnpm-lock.yaml`

## 6. Rules are not yours to invent

If `docs/PROJECT_GUIDE.md` is ambiguous, contradictory or impossible to implement:

1. write it in your ops log and report,
2. open an issue,
3. propose a doc change.

Do **not** silently implement a different rule in code. Code that contradicts the guide is invalid code.

## 7. Local development

```bash
pnpm install
pnpm db:migrate      # creates the local sqlite database
pnpm dev             # api on :3000, web on :5173
pnpm test
```

Copy `.env.example` to `.env` first. Never commit `.env`.