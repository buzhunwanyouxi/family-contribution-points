---
task_id: W1-HUB
operator: 发起人(buzhunwanyouxi)
ai: DSH (DeepSeek Harness)
date: 2026-10-13 20:00
module: docs/coordination + scripts
branch: main
status: done
related_requirements: [第 14 章]
---

## 1. 本轮目标(一句话)

建立**协作消息总线**:让"需求变更"不再依赖发起人逐个转述,而是住进仓库、由每个 AI 开工时读出来告诉自己的使用者。

## 2. 变更文件清单

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `docs/coordination/README.md` | 新增 | 机制说明:问题定义(授权断点 + 上报断点)、四条设计原则、通道边界、防失控规则、失败排查 |
| `docs/coordination/PENDING.json` | 新增 | **唯一的待办账本**(结构化)。5 条真实待办 |
| `docs/coordination/INBOX-*.md` ×3 | 新增(生成物) | 每人一份收件箱,**由脚本生成,禁止手改** |
| `docs/coordination/STATUS.md` | 新增(生成物) | 全局总览:谁有几条待办 |
| `scripts/sync-inbox.mjs` | 新增 | 生成器 + 一致性检查(`--check`) |
| `AGENTS.md` | 修改 | **新增「第 0 步:读收件箱并口述给使用者」**;必读顺序表补第 0 行;修正过时的令牌说明(细粒度→经典令牌);每轮固定动作加入"读收件箱"与"移出 PENDING" |
| `CONTRIBUTING.md` | 修改 | 5.1 节新增三条硬规矩:禁止只回"收到"、消息不得定义规则、**重复提问即系统缺陷** |
| `package.json` | 修改 | 新增 `sync:inbox` / `sync:inbox:check` |
| `docs/ai-logs/INDEX.md` | 修改 | 追加本行 |

## 3. 接口与数据变更

- **新增数据格式**(非 HTTP 接口):`docs/coordination/PENDING.json`。字段:`id / title / to / kind / since / source / action / needs / note`。
  `kind` 枚举:`decision | blocked | review | task | must-know`。**`source` 必填** —— 消息不许自己定义规则,只能指向规则。
- **新增命令**:`pnpm sync:inbox`(生成)、`pnpm sync:inbox:check`(只校验,退出码非 0 表示有问题)。
- **破坏性变更**:无。所有改动都在文档与工具层,没有触碰 `apps/**` 的运行时代码。

## 4. 尚未完成 / 遗留 TODO

- [ ] **未在 CI 里挂 `sync:inbox:check`**(仓库还没有 CI;等 infra 那条线做起来再接)
- [ ] 收件箱目前只由 `PENDING.json` 驱动,**没有自动从 `ROADMAP.md` / `OWNERS.md` 推导**"我认领了什么、我在等谁"—— 这两块暂由人工写进 `PENDING.json`(见第 5 节的取舍说明)
- [ ] `PENDING.json` 里的 5 条待办都是真实待办,做完后应被各自负责人移除

## 5. 阻塞与风险(需要谁配合)

### 风险 1:只做了一个真相源的两个视图,没做"自动推导"

本轮**没有**让脚本去解析 `ROADMAP.md` / `OWNERS.md` 的表格来生成"我的待办"。
理由:那样等于把同一份信息**再从 Markdown 表格里解析一遍**,表格一改格式解析就断,属于"看起来自动化、实际更脆"。
**当前取舍**:待办由人写进 `PENDING.json`(每条 30 秒),`source` 指回权威文档。**信息仍然只有一处权威。**

### 风险 2:这套机制依赖"人愿意看一眼"

如果某位协作者**根本不看仓库**,收件箱写得再好也没用。这**不是本机制能解决的**(见 README 第七节)。
兜底:GitHub 指派 + 邮件。**再不行就是人的问题,不要再优化系统。**

### 风险 3:`AGENTS.md` 第 0 步是否真的会被执行,需要下一轮验证

"AI 会读 AGENTS.md"是这套机制的**唯一假设**。下一轮任何人开工时,观察他的 ops 日志/PR 里
**有没有"我口述了收件箱"的痕迹**;若没有,说明假设不成立,需要改成更强的机制(例如提交前钩子)。

## 6. 如何验证本轮改动

```bash
# 1) 生成收件箱(应输出 4 个文件、退出码 0)
pnpm sync:inbox

# 2) 一致性检查
pnpm sync:inbox:check          # 期望:一致性检查通过 / 退出码 0

# 3) 故意制造坏数据,确认会被拦住(改完记得还原)
#    把任一条的 kind 改成 "urgent",或把 source 指向不存在的文件
pnpm sync:inbox:check          # 期望:列出问题 + 退出码 1
git checkout -- docs/coordination/PENDING.json

# 4) 看自己的收件箱
cat docs/coordination/INBOX-buzhunwanyouxi.md

# 5) 确认没有碰坏代码
pnpm -r typecheck && pnpm --filter @fcp/api test    # 期望:136 个测试全绿
```

实测结果:退出码符合预期;`PENDING.json` 带 UTF-8 BOM 时也能读(见第 7 节);typecheck 3 包 Done、136 测试全绿。

## 7. ★ 给下一个接手者的交接建议

**这套东西怎么改**:

1. 改机制 → 只改 `docs/coordination/README.md` 与 `scripts/sync-inbox.mjs`;
   改模板 → 改脚本里的 `renderInbox()`。
2. **不要手改 `INBOX-*.md` 与 `STATUS.md`** —— 下一次 `pnpm sync:inbox` 会覆盖,白改。
3. 加一条待办的最小写法(照抄):

   ```jsonc
   {
     "id": "唯一标识",
     "title": "一句话说清要做什么",
     "to": ["GitHub 登录名"],
     "kind": "task",
     "since": "2026-10-13T12:00:00Z",
     "source": "docs/CONTRACTS.md#10b",
     "action": "具体要做什么",
     "needs": "AI 可直接开工"
   }
   ```

4. **`to` 必须写 GitHub 登录名,不是显示名**(`MIAO98J`,不是 `Tousnad-layer sonw`)—— 本项目踩过这个坑。
5. **`since` 写"变更发生的时间",不是"你写这条的时间"** —— 收件箱靠它排序。

**下一轮该做什么(优先级)**:

1. PR #2 合并后,把 `family-unlock-for-frontend` 这条落实:关掉 `VITE_USE_MOCK`,跑真实登录/建家流程。
2. `#10b` 邀请码展示接口(**仍未认领**)—— 前端 P12 需要它。
3. `media-proof.upload` + `points` 落库:这是"派任务→评分→积分"闭环的最后两块,不打通就演示不了完整故事。

**别踩的坑**:

- **用 PowerShell 的 `Set-Content` / `Out-File` 写 `PENDING.json` 会加 UTF-8 BOM。**
  本轮就踩了:Node 的 `JSON.parse` 直接崩(报 `Unexpected token '﻿'`)。脚本已容错(主动剥 BOM),
  但**新建文件时请用不带 BOM 的编辑器**,否则别的工具可能不认。
- **`PENDING.json` 是共享文件**:两人同时改会冲突。冲突时**保留双方条目**(和 `INDEX.md` 同一原则)。

## 8. ★ 我在别人代码里发现的问题

**无。**

本轮只动文档与工具,没有评审别人的代码。上一轮(A 的 auth 模块)评审结论仍然有效:
仅一条低危文案问题(缺 token 时回"登录已过期"),已作为待办 `auth-401-wording` 登记在 `PENDING.json`。

## 9. 文档同步情况

- [x] `docs/coordination/README.md`(新机制说明)
- [x] `docs/coordination/PENDING.json`(待办账本,含 5 条真实待办)
- [x] `AGENTS.md`(第 0 步 + 令牌说明修正)
- [x] `CONTRIBUTING.md`(5.1 三条硬规矩)
- [x] `package.json`(两条新命令)
- [x] `INDEX.md`(本行)
- [ ] `PROJECT_GUIDE.md` 第 14 章 —— **本轮未改**:待第 0 步在真实一轮里被验证有效后,再把"消息总线"写进协作规范正式章节
