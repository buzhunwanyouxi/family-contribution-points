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

> **例外**:你自己的功能分支在 **rebase 之后**必须用
> `git push --force-with-lease origin <你的分支>` 推送 —— 这是唯一允许的强推场景,
> 而且**只能推你自己的分支**。`--force-with-lease` 会在别人也推过这个分支时失败,这是保护。

## 3.5 解冲突:rebase 期间的 `--ours` / `--theirs` 是**反的**(实测陷阱)

这是本项目踩过的坑,务必记住:

| 场景 | `--ours` 指谁 | `--theirs` 指谁 |
|---|---|---|
| **`git merge`**(把别人合进你) | 你当前的分支 | 被合并进来的分支 |
| **`git rebase`**(把你的提交搬到上游之上) | ⚠️ **上游(通常是 `main`)** | ⚠️ **你自己的分支** |

原因是 rebase 会先把 HEAD 切到上游、再逐个重放你的提交,所以"我这边"变成了上游。

**因此在 rebase 冲突里**:

- 想保留 **`main` 的版本** → `git checkout --ours <文件>`
- 想保留 **你分支的版本** → `git checkout --theirs <文件>`
- 想**两边都要** → 手动编辑,删掉 `<<<<<<<` / `=======` / `>>>>>>>` 三行标记,**两组内容都留下**

> 不确定时**别猜**:用 `git show :2:<文件>`(ours)与 `git show :3:<文件>`(theirs)
> 各看一眼,再决定。这四个字符的差别,足以让你**悄悄丢掉别人的改动**。

## 4. Pull requests

Every PR description must contain:

- the module name and the requirement IDs it implements
- a link to this round's ops log and report
- how a reviewer can verify it by hand
- a clearly marked **breaking changes** section (empty is fine, but write it)

Every PR needs at least one human reviewer, who **checks the ops log against the diff**.
A log that says "3 files changed" and a diff with 8 files is a rejected PR.

### 4.1 合并顺序:**先请求评审,评审通过后才合并**(2026-10-12 新增)

真实事故(PR #1):作者在 rebase 之后**先被合并、后才点"请求评审"**,结果 review 请求落在了一个已关闭的 PR 上,
GitHub 不允许再补交评审 —— 那次评审只能挪到"合并后的代码"上补做。

**规则**:

1. 作者认为可以合并时,**先在 PR 里留一条评论**:`已自测通过(typecheck + 全部单测 + 手工验证),请求评审 @<所有者>`。
2. 评审者**评审通过后再点合并**。**不要"先合并再评审"**,也不要默认"没消息就是可以合"。
3. 评审者如果要合并,应在 PR 里回一句"评审通过,已合并" —— 让流程在 PR 上留痕。
4. 需要**第二个 PR 顺序合并**时,顺序由所有者指定;**被并的那个 PR 的作者要再 rebase 一次**,
   这是正常成本,不是返工(`docs/PROJECT_GUIDE.md` 14.5)。

> 为什么写死成评论而不是只靠按钮:合并权在仓库所有者手里,而**所有者并不知道作者是否已准备好**;
> 一条明确评论能把"我以为他还没好"这种猜测消掉。

## 5. Shared files (serialize your edits)

These are touched by everyone. Announce in your ops log before changing them, and update
`docs/CONTRACTS.md` in the same round:

`packages/shared/src/types/**` - `apps/api/prisma/schema.prisma` (+ migrations) -
`apps/api/src/routes/index.ts` - `packages/shared/src/constants.ts` -
`docs/CONTRACTS.md` - `package.json` / `pnpm-lock.yaml` -
`docs/coordination/PENDING.json` (每人只改自己相关条目)

### 5.1 协作消息总线:三条硬规矩(2026-10-13 新增)

背景与机制见 [`docs/coordination/README.md`](docs/coordination/README.md)。这里只列**必须遵守**的三条:

1. **禁止只回复"收到/好的"。** 任何评论必须携带**具体动作请求**或**状态更新**,否则视为噪声,评审可打回。
   (多人多 AI 并行时,互相确认的消息会迅速淹没真正有用的信息。)
2. **消息里不得定义新规则。** 只出现在评论里、没进文档的"要求"一律按**不存在**处理。
   正确写法是**指回文档**:
   ```
   需求出处:docs/CONTRACTS.md #10b (sha: ec5ca31)
   需要你做:认领并实现该接口,或回复"暂不认领"
   ```
3. **同一件事被问第二次 = 系统缺陷。** 说明它没进 `docs/coordination/PENDING.json`。
   请补录该条目,并在 `note` 里写明"因被重复提问而补录" —— 这是本机制的自我修正路径,
   不要用"我再说一遍"来解决。

> 配套动作:**开工前读收件箱并口述给你的使用者**(`AGENTS.md` 第 0 步);
> **完工后把自己做完的条目从 `PENDING.json` 移除**。

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