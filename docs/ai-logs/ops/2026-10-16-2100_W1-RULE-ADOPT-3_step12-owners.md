---
task_id: W1-RULE-ADOPT-3
operator: 发起人(buzhunwanyouxi)
ai: DSH (DeepSeek Harness)
date: 2026-10-16 21:00
module: docs(采纳第 3 条 spec-gap)
branch: main
status: done
related_requirements: [第 14 章]
---

## 1. 本轮目标(一句话)

执行人的采纳决定:把「收工要同步 `OWNERS.md` 进度」写进 `AGENTS.md` 第 12 步,并让校验器强制三处副本一致。

> **授权记录**:发起人原话 ——「算了你自己操控我电脑改吧,我同意的,遵守流程就行」(2026-10-16)。
> 决定人是发起人,AI 只负责把改动落到文件里。**这条已记进 `SPEC-GAP-LOG.md` 的责任归属表。**

## 2. 变更文件清单

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `AGENTS.md` | 修改 | 第 12 步扩为「验证输出 + 移出 PENDING + **同步 OWNERS**」;新增「第 12 步」专节;流程图与收工四件套说明同步 |
| `docs/coordination/SPEC-GAP-LOG.md` | 修改 | 第 3 条裁决;新增「裁决是怎么做出来的(责任归属)」表,记决定人 / 执行人 / 授权原话 |
| `docs/coordination/PENDING.json` | 修改 | 移除已采纳条目(采纳 = 移走留档,不是改状态) |
| `scripts/sync-inbox.mjs` | 修改 | 收工清单从 **5 项扩到 6 项**;短提示词补 OWNERS 条目;比较前剥掉反引号 |
| `docs/coordination/PROMPT-TO-AI.md` | 修改 | ③ 补「更新 OWNERS.md 的进度」并说明原因 |
| `docs/ai-logs/OWNERS.md` | 修改 | `docs` 行改为「进行中」+ 记本轮改动(**立即执行刚采纳的规则**) |

## 3. 接口与数据变更

- **规则变更**:固定动作第 12 步新增第二项 —— 改了某模块代码 → 更新 `OWNERS.md` 该行的
  「状态 / 最后更新 / 实测进度」。
- **校验变更**:`sync:inbox:check` 的收工清单检查从 5 项 → 6 项。
- **代码/接口/数据表:无变化。**

## 4. 尚未完成 / 遗留 TODO

- [ ] `docs/DAY1-PLAN.md` 与 `OWNERS.md` 的文件归属表**仍在重复维护**(需人拍板是否合并)
- [ ] `#11`-`#14` 仍无人认领
- [ ] 前端仍未接 `#15` / `#10`

## 5. 阻塞与风险(需要谁配合)

### ★ 发现 1:采纳过程中又撞到"改了一处忘了另一处"—— 第三次

改完 `AGENTS.md` 后我顺手跑了一次 `sync:inbox:check`,它立刻报:

```
长版提示词(PROMPT-TO-AI.md) 的收工清单缺 1 项(更新 OWNERS.md 的进度)
固定动作表(AGENTS.md) 的收工清单缺 1 项(更新 OWNERS.md 的进度)
```

**两处都"看起来加了",实际都没匹配上** —— 原因是我把字串写成 `同步 \`OWNERS\``,
而检查器比的是**字面量**,markdown 的反引号让它匹配不到。

**这次是校验器救了我,而不是我自己记得。** 这正是它存在的理由 ——
而且说明**校验器的价值不在"记住",在"不让人自己判断是否记得"**。

**两处修法**:
① 统一措辞为「更新 OWNERS.md 的进度」;
② **比较前剥掉反引号**(`text.replace(/`/g, '')`)—— 否则同一个指令写成 `OWNERS.md` 或 OWNERS.md
就会一边通过一边失败,**这是格式差异被误判成漏改**,会让人开始不信任校验器。

### ★ 发现 2:采纳的条目要"移走",不是"改状态"

`SPEC-GAP.md` 第七节写的是「采纳 → 改权威文档 + `status: adopted` + ops 日志记一笔」,
但 `PENDING.json` 的 `_readme` 写的是「采纳 → 移入 `SPEC-GAP-LOG.md` 并从本文件删除」。

**两处说法不一致**,而后者更对:**待办清单不该留着已办完的事**。本轮按后者执行,
并在 `SPEC-GAP-LOG.md` 里记全了"改了什么、谁决定的、原话是什么"。

> **建议**:`SPEC-GAP.md` 第七节那句话可以补一句"采纳后从 `PENDING.json` 移除,记录在本文件",
> 让机制文档与账本约定一致。**这属于规则文档改动,我没有自己动** —— 见第 8.5 节。

### 风险:规则变长了,而 `AGENTS.md` 已经偏长

本轮给 `AGENTS.md` 加了约 30 行(第 12 步专节)。它现在约 **250 行**。
这份文档之前的规模争议(提案 ①:压回 ~100 行索引)仍悬着,而本轮是**加法**。

**缓解**:第 12 步专节里放了"为什么"和"边界",属于可外移内容 ——
若将来做分层,这一节能整体挪进 `docs/coordination/`。**已在专节里写成相对独立的块**,便于搬。

## 6. 如何验证本轮改动

```bash
# 1) 三处副本一致(现在含第 6 项)
pnpm sync:inbox:check          # 期望:一致性检查通过,退出码 0

# 2) 反向验证:故意删掉第 6 项,必须报警
#    编辑 PROMPT-TO-AI.md 把「并更新 OWNERS.md 的进度」删掉,然后:
pnpm sync:inbox:check          # 期望:提醒"缺 1 项(更新 OWNERS.md 的进度)"
git checkout -- docs/coordination/PROMPT-TO-AI.md

# 3) spec-gap 机制自检
node scripts/sync-inbox.mjs --self-test   # 期望:6/6

# 4) 台账里这条应已消失
node -e "const l=require('./docs/coordination/PENDING.json'); console.log(l.items.map(i=>i.id))"
# 期望:不含 specgap-owners-progress-not-in-checklist

# 5) 回归
pnpm -r typecheck && pnpm -r test
```

**实测**:`sync:inbox:check` 通过(无提醒);**反向验证报警了**(删一处 → "缺 1 项");
`--self-test` 6/6;台账 4 条,已不含该 spec-gap;3 包 typecheck Done、298 + 13 用例全过。

**特别说明**:反向验证这一轮**不是走过场** —— 它是**先报警、后修**的真实过程。

## 7. ★ 给下一个接手者的交接建议

**先读** `AGENTS.md` 的「第 12 步」专节 —— 它解释了为什么收工要登记三样东西,
以及**为什么只许登记状态、不许改排期**。

**接着做最省事的顺序**:

1. **认领清单第 1、2 项**(把 `#15` / `#10` 接到界面):后端已就绪,不依赖任何人
2. `TaskInstance`(关键路径起点)

**别踩的坑**:

- **改了收工清单的任一项,必须三处同改**:`AGENTS.md`、`docs/coordination/PROMPT-TO-AI.md`、
  `scripts/sync-inbox.mjs` 里的短提示词。**措辞要字面一致**(校验器按字面比对,
  但它现在会先剥掉反引号)。
- **`OWNERS.md` 的日期不能忘**。加了这一列而不填,等于没加 —— 判据是"超 14 天未更新视为已失联"。
- **采纳 spec-gap 后要"移走"台账条目**,不是留下 `adopted` 状态。

## 8. ★ 我在别人代码里发现的问题

**无新增。**

**一处机制文档的不一致**(我在第 5 节发现 2 里写了):`SPEC-GAP.md` 第七节说"status 改 adopted",
而 `PENDING.json` 约定"移除并记入 `SPEC-GAP-LOG.md`"。两者对"采纳后条目去哪"不一致。

**按禁令 8,我没有自己改 `SPEC-GAP.md`** —— 它是约束我的机制文档。
建议下次有人拍板时一并修掉那句话。

**我自己的两条仍在**:`docs/CONTRACTS.md` 两节边界指引;`PENDING.json` 的 `note` 不应写快照数字。

## 8.5 ★ 本轮**未验证**的维度

**我排除的维度(排除 + 依据)**:

- **`SPEC-GAP.md` 第七节措辞的修正**:依据 = 禁令 8,机制文档我自己不能改(见第 8 节);
  只能记录建议
- **`AGENTS.md` 的行数治理**:依据 = 提案 ① 的取舍属于人类(分层还是保留),而且本轮是执行采纳,
  不适合同时做重构

**我根本没测的维度(没碰 + 漏了会怎样)**:

- **这条新规则会不会真的被执行**:完全没验证,也无法验证。漏了会怎样 =
  **规则写进去了但没人照做,`OWNERS.md` 继续过期** —— 这正是本轮要治的病,
  但我治的仍是"有没有写进规则",不是"会不会被遵守"
- **`OWNERS.md` 的"14 天失联"判据有没有人真的会用它**:没测。
  漏了会怎样 = 判据形同虚设,下一个人照样直接开工
- **`docs/DAY1-PLAN.md` 的漂移**:没碰。漏了会怎样 = **两份重复的文件归属表继续各自漂移**
- **校验器在 CI 里跑时的行为**:本轮改了检查逻辑(剥反引号),但 CI 用的是同一份脚本,
  预计一致 —— **然而没有在 CI 上看到这次改动的实际输出**,只在本机跑过

## 9. 文档同步情况

- [x] `AGENTS.md`(第 12 步 + 专节 + 流程图 + 四件套说明)
- [x] `docs/coordination/SPEC-GAP-LOG.md`(第 3 条裁决 + 责任归属表)
- [x] `docs/coordination/PENDING.json`(移除已采纳)
- [x] `docs/coordination/PROMPT-TO-AI.md`(③ 补 OWNERS)
- [x] `scripts/sync-inbox.mjs`(6 项检查 + 剥反引号)
- [x] `docs/ai-logs/OWNERS.md`(docs 行更新 —— **立即执行新规则**)
- [x] `INDEX.md`(本行)
- [ ] `docs/coordination/SPEC-GAP.md` 第七节 —— **未改**(禁令 8),建议已记录在第 8 节
