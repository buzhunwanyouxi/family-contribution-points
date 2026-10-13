# 收件箱:MIAO98J

> ⚠️ **本文件由 `scripts/sync-inbox.mjs` 自动生成,不要手工编辑。**
> 要新增/移除待办,请改 [`PENDING.json`](PENDING.json);要改权威内容,请改 `source` 指向的那份文档。

**最后生成**:2026-10-13 20:04 @ `2acb1b2`  ·  **你现在必须知道的**:1 件开工

---

## 开工(1)

### 1. PR #2(family 模块)需要 rebase 到最新 main

- **开工**:按评论里的逐项对照表解冲突(CONTRACTS.md 保留双方小节、INDEX/OWNERS 用 main 版本、routes/index.ts 两行注册都留),然后 push --force-with-lease
- **从此刻起有效**:2026-10-12T05:04:25Z
- **权威出处**:https://github.com/buzhunwanyouxi/family-contribution-points/pull/2#issuecomment-6118199026
- **需要谁**:AI 可直接开工
- **备注**:behind 6;冲突点已实测过,对照表里写清了每个文件用哪一边

---

## 开工前你应该做的(来自 AGENTS.md 第 0 步)

1. **把上面每一条完整口述给你的使用者**(逐条念,带出处链接)—— 他不知道这些,只能去问发起人。
2. **不要总结成一句话**:出处链接就是他的核对依据,总结会把它丢掉。
3. 等你确认后再开始干活。

## 收工时你应该做的(三件不同的事,别混为一谈)

| # | 验证什么 | 怎么做 |
|---|---|---|
| ① | 验证**代码** | `pnpm -r typecheck && pnpm --filter @fcp/api test`,贴原始输出 |
| ② | 验证**输出** | 把你这一轮**产生的需求**写进 `docs/coordination/PENDING.json`,跑 `pnpm sync:inbox`,连生成物一起提交 |
| ③ | **反查收件箱** | **重新读一遍本文件**,找出**开始时间晚于你这轮开工时间**的条目 —— 那是别人**在你干活期间**新提的需求。逐条念给使用者听,判断要不要返工 |

> ⚠️ **③ 最容易漏,而且和 ① 完全不是一回事**:① 只能证明你的代码没坏,证明不了"你干活期间世界没变"。不反查,PR 就可能刚交上去就要返工。
> 若某条新需求让你"差点做错",写进 ops 日志第 8 节;若某条已被你顺带解决,把它从 `PENDING.json` 移除。

### 📋 请把这段话转给你的使用者(他下次开工要用)

```
下次让我开工时,请把这段提示词贴给我,我会先读收件箱再动手:

  我的 GitHub 登录名是 MIAO98J,请在 family-points 仓库里按项目规则工作。
  先不要写代码,按顺序做:
  1) 读 docs/coordination/INBOX-MIAO98J.md,把每一条完整念给我听(带权威出处链接,不要总结);
  2) 读 AGENTS.md、docs/CONTRACTS.md、docs/ai-logs/OWNERS.md 和最近三篇 ops 日志,
     告诉我:有哪些模块可认领?我要做的事依赖的接口定稿了吗?有什么坑要避开?
  3) 按 AGENTS.md 第四节填好工作计划,说明我之后怎么验证,然后停下来等我确认;
  4) 我确认后再干活;收工时自测、写日志、更新文档、
     把你这轮产生的需求写进 docs/coordination/PENDING.json 并提交;
  5) 提 PR,并写明"已自测通过,请求评审"。

  完整版提示词(含收工检查、卡住时怎么办):docs/coordination/PROMPT-TO-AI.md
```

> 完整模板(含收工提示词、卡住时的提示词、以及"AI 跑偏了长什么样"):
> [`PROMPT-TO-AI.md`](PROMPT-TO-AI.md)

> 若你发现同一件事**被问过两次**,那是**本系统的问题**,不是沟通问题:
> 说明这条没进 `PENDING.json`,请补进去 —— 见 [`README.md`](README.md) 的"重复提问即缺陷"。
