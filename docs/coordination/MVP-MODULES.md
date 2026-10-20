# MVP 模块划分(2026-10-20)

> **这份文件回答一个问题**:从"后端接口做完 9 个"到"一个真实家庭能连续运转 7 天",
> 中间缺的到底是**哪几块**,每块**谁做、做完怎么算、依赖谁**。
>
> 权威顺序:`docs/PROJECT_GUIDE.md`(规则)> `docs/CONTRACTS.md`(接口)> 本文件(排期与拆分)。
> 本文件**不定义规则**,只把已有规则拆成能直接开工的工作单元。

---

## 0. 现状:闭环断在哪

```
账号 ✅ → 建家 ✅ → 邀请 ✅ → 加入 ✅          (A / B / C 已交付)
                                    ↓
                          ❌ 任务从哪来?     ← 断点 1:没有任务模板
                                    ↓
                          ❌ 谁接?           ← 断点 2:没有 TaskInstance
                                    ↓
                          ✅ 上传证据        (#10 已完成)
                                    ↓
                          ❌ 谁评分?         ← 断点 3:没有 #13
                                    ↓
                          ❌ 积分怎么变?     ← 断点 4:没有 #14 结算
                                    ↓
                          ✅ 查积分          (#15 已完成,但恒为 0)
```

**四个断点,对应下面 6 个模块(M1–M6)。**

---

## 1. 模块总览

| 模块 | 内容 | 契约 | 依赖 | 建议工作量 | 建议负责人 |
|---|---|---|---|---|---|
| **M1** | **`TaskInstance` 地基**(实体 + 仓储 + 查询) | 新增 #16/#17 | **无** | 1 天 | **发起人** |
| **M2** | **固定任务模板 CRUD** | `#11` | **无**(独立) | 1 天 | **`sun-521-s`** |
| **M3** | **J1 每日任务实例生成** | 无(作业) | M1, M2 | 半天 | 发起人 |
| **M4** | **抢单 / 15 分钟无责退单** | `#12` | M1 | 1 天 | 发起人 |
| **M5** | **评分**(创始人必评 / 他人选评) | `#13` | M1 | 1 天 | 发起人 |
| **M6** | **结算 → 写积分流水** | `#14` | M1, M5 | 1 天 | 发起人 |

**关键路径**:`M1 → M4 → M5 → M6`。
**M2 是唯一能完全并行开工的模块**(不依赖 M1),所以先派出去。

---

## M1 · `TaskInstance` 地基 —— ✅ **已完成(2026-10-20)**

> **为什么叫"地基"**:后面四块全都挂在这一块上。它不做,`#12`/`#13`/`#14` 一行都写不了。
>
> **交付**:`apps/api/src/instances/`(types / errors / state / service / repository / repository.prisma)
> + `apps/api/src/routes/instances.ts` + `CONTRACTS #16/#17`。**49 个用例**。
> `media/instances.ts` 占位已删除,media 现在经 `InstanceReader` 端口读真实实例。
> **四条状态机判据全部落地**:非法流转 409、同状态幂等、终态不可回、并发抢单只有一个成功。

**新建目录**:`apps/api/src/instances/`(注意:`apps/api/src/task` 已被 `task-temp` 预留,不能占用)

| 文件 | 内容 |
|---|---|
| `types.ts` | `TaskInstanceRecord`、`InstanceStatus`(`open\|claimed\|doing\|pending_score\|done\|rejected\|abandoned`)、`InstanceRepository` 接口 |
| `repository.ts` | 内存实现(冷克隆零配置可跑,ADR-004) |
| `repository.prisma.ts` | Prisma 适配(与 `auth`/`family` 同款,便于切换) |
| `service.ts` | **唯一的状态机**:状态流转规则集中在这一处,任何路由都不许自己改 `status` |
| `errors.ts` | `instance_not_found` / `invalid_status_transition` / `not_a_member` … |
| `index.ts` | 对外导出 |
| `*.test.ts` | 状态机 + 仓储 |

**新增路由**:`apps/api/src/routes/instances.ts`
- `GET /api/families/:fid/instances?date=YYYY-MM-DD` —— 今日任务列表(**前端今日页要用**)
- `GET /api/families/:fid/instances/:iid` —— 单个任务详情

> ⚠️ **这两个是新增接口,需要在 `CONTRACTS.md` 里补 `#16` / `#17`**。
> 契约可以增长(见 `SPEC-GAP.md` 第三节"范围可以长"),但**必须先补契约再写代码**。

**做完的判据**:
1. 内存仓储能存/查/按日期过滤
2. 状态机**拒绝非法流转**(如 `open` 直接跳 `done`),且有测试
3. 两条读接口在 `/api/families/...` 下,非成员 → 403(与既有行为一致)
4. 跨模块:建家 → 手工造一个实例 → 能通过 HTTP 查到
5. `apps/api/src/media/instances.ts`(**占位文件**)被删除,改为注入真实 `InstanceReader`

---

## M2 · 固定任务模板 CRUD(`#11`,B1–B8)

> **可以立刻开工,不依赖任何人。** 这是唯一能完全并行的模块。

**新建目录**:`apps/api/src/template/`

| 文件 | 内容 |
|---|---|
| `types.ts` | `TaskTemplateRecord`、`CreateTemplateInput`、`TemplateRepository` |
| `repository.ts` | 内存实现 |
| `service.ts` | 创建/查询/暂停/恢复(B7) |
| `repeat.ts` | **纯函数**:`repeatRule` 解析(`daily` / `weekly:1,3,5` / `monthly:1`)→ 判断某天是否应生成 |
| `errors.ts` | `not_owner`(B1:仅创始人可写)/ `invalid_repeat_rule` / … |
| `*.test.ts` | 含边界:`weekly:7`(周日)是否合法、空数组、越界日期 |

**新增路由**:`apps/api/src/routes/templates.ts`
- `POST /api/families/:fid/templates`(`#11`)
- `GET /api/families/:fid/templates`(列表,前端任务表要用)

**必须遵守的规则**(出处 `PROJECT_GUIDE` 4.x):

| 编号 | 规则 |
|---|---|
| **B1** | **仅创始人(owner)可创建**,其他角色一律 403 |
| **B2** | 每个模板**必须有 `maxPoints`**,且 > 0(这是评分乘数的上限) |
| **B3** | 可设提醒时间,默认提前 30 分钟(`remindBeforeMin`) |
| **B5** | 接取模式:`claim`(抢单)/ `rotate`(轮值) |
| **B6** | 接取范围:`all` / `children` / `specific` |
| **B7** | 可**暂停 / 恢复**(`status: active \| paused \| archived`),历史记录保留 |

**做完的判据**:
1. 非 owner 创建 → **403**(不能只在前端拦)
2. `maxPoints` 缺失或 ≤ 0 → 400
3. `repeatRule` 非法格式 → 400,错误信息说清正确格式
4. `repeat.ts` 有独立测试:**同一规则在不同日期判断结果正确**(这是最容易写错的部分)
5. 暂停后的模板不在活跃列表里,但历史保留

> **为什么这条给 `sun-521-s`**:它**不依赖 M1**、**新建目录不碰任何人的既有代码**、
> 规则清晰(B1-B8 有原文)、而且 `repeat.ts` 是**纯函数**——和他在 auth 里写的
> `identifiers.ts` / `jwt.ts` 是同一类工作。

---

## M3 · J1 每日任务实例生成

**文件**:`apps/api/src/instances/generate.ts` + 调度接线

| 部分 | 内容 |
|---|---|
| 纯函数 | `generateForDate(templates, date, timezone) → DraftInstance[]`(幂等:同一天重复跑不产生重复实例) |
| 调度器 | 每小时/每日调用一次(先做**手动触发入口**,自动调度等 W4-05 统一做) |

**做完的判据**:
1. 幂等:**同一天跑两次,实例数不变**
2. 暂停的模板不生成
3. `weekly:1,3,5` 只在周一/三/五生成(用固定日期测)
4. 时区按家庭设置(默认 `Asia/Shanghai`)

---

## M4 · 抢单 / 无责退单(`#12`,D1–D5)

**新建目录**:`apps/api/src/assignment/`

| 文件 | 内容 |
|---|---|
| `claim.ts` | 纯逻辑:`canClaim(instance, member, now)` / `isWithinFreeCancel(claimedAt, now)` |
| `service.ts` | 抢单、退单、弃单计数 |
| `*.test.ts` | 15 分钟边界、并发抢单 |

**规则**:

| 编号 | 规则 |
|---|---|
| **D1** | 已被接取的任务,其他人**不可重复接** |
| **D2** | 接取后 **15 分钟内无责退单**;超过只记一次"弃单",**不扣积分** |
| **D5** | 截止前 30 分钟无人接 → 通知;**到点仍无人接 → 强制指派**给"本周贡献最低 + 当前空闲"的成员,标记 `autoAssigned` |

**做完的判据**:
1. 两人同时抢 → **只有一个成功**,另一个 409
2. 退单在 15 分钟内 → 任务回到 `open`,**无记录**;超过 15 分钟 → 回 `open` + 记一次弃单
3. 弃单**不扣积分**(扣分会破坏积分口径)

---

## M5 · 评分(`#13`,E1–E6)

**文件**:`apps/api/src/scoring/score.ts` + 路由

**已有的可复用部分**:`scoring/settle.ts` 里已有 `clampPercent` / `roundToStep` / `previewSettlement`,
**评分模块必须用它,不许另写一份**(AGENTS.md 第五节坑 2)。

**规则**:

| 编号 | 规则 |
|---|---|
| **E1** | **创始人必评分** |
| E2 | 其他人**可选**评 |
| E3 | 完成度下限 **30%** |
| E6 | 百分比按 **5%** 取整 |

**做完的判据**:
1. 同一人对同一实例只能评一次(再评 → 409 或覆盖,需按 `PROJECT_GUIDE` 原文定)
2. `percent` 超出 0–100 → 400;低于 30% 的处理按原文
3. 取整到 5% 的边界值正确
4. 评分后实例状态 → `pending_score`

---

## M6 · 结算 → 写积分流水(`#14`,E4/E7–E13/F*)

> **这是"积分第一次变成非 0"的那一步。** 做完 MVP 闭环才真正通。

**文件**:`apps/api/src/scoring/settle-instance.ts` + 路由

| 步骤 | 做什么 |
|---|---|
| 1 | 汇总该实例的所有评分,**调已有的 `previewSettlement()` 算结果**(不许另写算法) |
| 2 | 写一条 `PointsTxn`(**`earned: true`**,`refType: 'instance'`, `refId`) |
| 3 | 更新 `Membership` 的四个数字:`earnedPoints += points`、`points += points` |
| 4 | 实例状态 → `done`,`finalPercent` / `finalPoints` / `settledAt` / `settledBy` |

**必须遵守**:

- **不要改 `ledger.ts` / `settle.ts`** —— 它们是唯一口径实现,只允许**调用**
- **冲正用新流水,不许改历史**(创始人补分场景)
- 写完必须有测试断言 **`earned − spent === available`** 仍成立

**做完的判据**:
1. 结算后 `GET .../points/:uid` 的 `earned` / `available` **第一次变成非 0**
2. 实例状态 `pending_score → done`,四个结算字段都写了
3. 重复结算 → **幂等**(第二次不重复加分)或 409
4. 恒等式测试通过

---

## 2. 分配

| 模块 | 负责人 | 理由 |
|---|---|---|
| **M1** | **发起人** | 关键路径起点,后续四块都要用它;且会删掉我造的占位文件 |
| **M2** | **`sun-521-s`** | **不依赖 M1**,可立刻并行;新建目录不冲突;纯函数为主,与他在 auth 的工作同类 |
| M3–M6 | **发起人** | 全部依赖 M1,串行;中途无法拆给别人而不打断状态机 |
| — | **`MIAO98J`** | **本轮不分配**(按发起人指示);`#6`(family 端口化)转为待办池,不做指派 |

### 为什么这样分

1. **M2 是唯一能真正并行的**。把一条"必须等 M1"的活派出去,对方开工后立刻卡住 —— 那是假分工。
2. **M1–M6 共用同一个状态机**。拆给两个人写,必然出现两份 `status` 流转规则,
   而"口径只能有一份"是本项目的铁律(`AGENTS.md` 第五节)。
3. **`sun-521-s` 手上还有 `#5`(401 文案,15 分钟)**。那条在他的模块内、有明确判据,
   先做掉能立刻关闭一件事。

---

## 3. 契约需要新增的行(M1 开工前必须补)

| 编号 | 方法 | 路径 | 出参 | 谁 |
|---|---|---|---|---|
| 16 | GET | `/api/families/:fid/instances?date=` | `{instances: InstanceSummary[]}` | M1 |
| 17 | GET | `/api/families/:fid/instances/:iid` | `{instance: InstanceDetail}` | M1 |
| 18 | GET | `/api/families/:fid/templates` | `{templates: TemplateSummary[]}` | M2 |

> **规矩**:`AGENTS.md` 禁令 3 —— **禁止改了接口却不更新 `CONTRACTS.md`**。
> 契约优先于实现。上面三行由对应模块的负责人在**写代码之前**补进 `CONTRACTS.md`。


---

## 4. ⚠️ M1–M6 **不等于** MVP —— 还有三条硬缺口(2026-10-20 补)

> **为什么补这一节**:这份文档最初只写了 M1–M6,读起来像"做完这六个就好了"。
> **不是。** 六个模块做的是"任务 → 抢单 → 证据 → 评分 → 结算 → 积分"这条**逻辑链**。
> 一个真实家庭要连续用 7 天,还差三块,而且**每一块都不比 M1–M6 小**。

| 缺口 | 内容 | 现状 | 不做会怎样 |
|---|---|---|---|
| **P1 · 持久化** | 建 `prisma migrate` + 真正 `new PrismaClient()` + 配 `DATABASE_URL` | **0%**。仓库里 **0 个 migrations**,`PrismaClient` **0 处实例化** —— 所有模块实际跑的都是内存适配器 | **服务器一重启,今天所有任务和积分全丢。** "连续运转 7 天"在重启丢数据的前提下不成立 |
| **P2 · 前端接线** | 把已完成的 `#15` 积分 / `#10` 上传 / `#16` 实例接到界面 | **约 60%**。✅ `#15` 积分页 + `#16` 今日页**已接上并在真实后端验证**(2026-10-20)。❌ 上传证据界面(`#10` 后端已就绪)未接;评分界面等 `#13`;`MePage` 仍占位 | 后端做完了**没人看得见**。已解决一半 ——— 积分和任务现在是真的了 |
| **P3 · 通知** | 到期提醒(D9)/ 评分提醒(E5)/ 应用内红点 | **0%**。`notify` 目录都不存在 | 到点没人提醒,**家长必须自己盯着** —— 等于"人工记账",正好违反 MVP 判据 |

### 建议顺序

```
M1 ✅ → M2(并行,sun-521-s)→ M3 → M4 → M5 → M6
                                        ↓
                            P1 持久化(必须紧跟,否则前功尽弃)
                                        ↓
                            P2 前端接线(做完用户才真正能用)
                                        ↓
                            P3 通知(MVP 判据要求"不需要人工记账")
```

### ⚠️ P1 的一个陷阱

现在**所有模块**都只跑在内存里,包括已交付的 `auth` / `family` / `media`。
如果 P1 只给新模块接数据库,结果会是**一半持久、一半易失** —— 比全内存更糟,
因为出问题时**无法判断哪些数据丢了**。

**P1 必须一次把六个模块全切过去**,并且切换后所有既有测试仍要绿。
