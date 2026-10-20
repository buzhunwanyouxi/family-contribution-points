# 模块认领表(开工前必看)

> **规则**:同一模块同一时间只能有一个负责人。
> 开工前先看这里 —— 目标模块状态是`进行中`且负责人不是你,就**不要动它**,换一个模块或先沟通。
> 认领与完成时都请更新本表。

状态只有三种:`空闲` / `进行中` / `已完成`(可被再次认领做迭代,但要先标 `进行中`)。

> ### ⚠️ **"最后更新"是本表最重要的列**(2026-10-16 新增)
>
> 之前本表**没有日期**,于是没人能区分"这个『进行中』是昨天的还是三周前的"。
> 实测代价:2026-10-16 有人照本表安排工作,而当时 `points` 与 `media-proof` **早已做完**、
> `web-app` **也早就有测试** —— 表里全是旧状态。
>
> **认领或完成时必须同时更新本行日期。**
> 判据:**超过 14 天没更新的"进行中",默认视为已失联** —— 想用它的人应先去问一句,而不是直接开工。

## 人员对照表(以 **GitHub 登录名** 为准)

| 代号 | 名字 | GitHub 登录名 | 车道 | 独占目录 |
|---|---|---|---|---|
| A | Miao | `sun-521-s` | auth | `apps/api/src/auth/**` |
| B | 喵 | `MIAO98J` | family | `apps/api/src/family/**` |
| C | 发起人 | `buzhunwanyouxi` | scoring 作业 + 前端 | `apps/api/src/media/**`、`apps/api/src/points/**`、`apps/api/src/routes/**`、`apps/api/src/composition.ts`、`apps/web/**` |

> ### ⚠️ 2026-10-16 补记:两个"无主的热文件"已归入 C
>
> `apps/api/src/routes/**` 与 `apps/api/src/composition.ts` 原先**不在任何人的独占目录里**,
> 而它们恰恰最容易冲突 —— **所有人新增接口都要改 `routes/index.ts`**。
> 现归入 C(`buzhunwanyouxi`),并按 `docs/PROJECT_GUIDE.md` 14.5「共享文件串行」处理。

> ⚠️ **2026-10-10 分工对调**:最初 A=`MIAO98J` / B=`sun-521-s`,两人线下对调为 **A=`sun-521-s` / B=`MIAO98J`**。
> 本表、`docs/DAY1-PLAN.md` 已按新分工更新。
>
> **注意显示名不等于登录名**:`MIAO98J` 的显示名是 `Tousnad-layer sonw`;看 `git log`、开 PR、发邀请时请认**登录名**。

| 模块 | 目录 | 状态 | 负责人(人类) | AI 工具 | 关联需求 | 最后更新 | 实测进度 |
|---|---|---|---|---|---|---|---|
| auth | `apps/api/src/auth` | **已完成**(W1 范围) | Miao(`sun-521-s`) | DSH | A1, A3 | 2026-10-13 | 15 源文件 / 8 测试文件 / **91 用例**。注册·登录·JWT·`GET /api/auth/me` 全部实现。**A8 PIN 登录与"找回密码"未做** |
| family | `apps/api/src/family` | **已完成**(W1 + #10b) | 发起人(`buzhunwanyouxi`) | DSH | A2, A4, A5, A6, #10b | 2026-10-16 | 9 源文件 / 4 测试文件 / **85 用例**。#6–#9 车道 B 交付;#10b 邀请码由 C 追加。**共同管理员(A6)未做** |
| **routes** | `apps/api/src/routes` | **进行中** | 发起人(`buzhunwanyouxi`) | DSH | 全部接口 | 2026-10-16 | 9 个文件。**所有人新增接口都要动 `index.ts`** —— 全仓库最热的共享文件,改前先在 ops 日志声明 |
| **composition** | `apps/api/src/composition.ts` | **进行中** | 发起人(`buzhunwanyouxi`) | DSH | 第 14 章 | 2026-10-16 | 190 行 + **5 个跨模块用例**。**谁和谁共享状态由它决定** —— 它错了,模块各自"测试全绿"也会整体坏掉(2026-10-13 的 token 事故正是此类) |
| **instances**(M1) | `apps/api/src/instances` | **进行中** | 发起人(`buzhunwanyouxi`) | DSH | — | 2026-10-20 | **MVP 地基 —— 后四块全挂在它上面**。`TaskInstance` 实体 + 内存/Prisma 仓储 + **唯一状态机** + 2 条读接口。拆完会删掉 `media/instances.ts` 占位文件,改为注入真实 reader。拆分见 `MVP-MODULES.md` → M1。⚠️ 写代码前先补 `CONTRACTS.md` `#16`/`#17` |
| **task-template**(M2) | `apps/api/src/template` | **已完成** | Miao(`sun-521-s`) | DSH | B1-B8, #11, #18, #19 | 2026-10-20 | 6 源文件 / 3 测试文件 / **47 用例**。**已完成**:B1 仅 owner(403 `not_owner`,且先于字段校验)、B2 `maxPoints`>0、B3/B4/B5/B6 默认值、B7 暂停/恢复(幂等、历史保留)、`repeat.ts` 纯函数(`weekly:7`=周日;`monthly:31` 在 2 月不生成)。**未做**:B8 节假日任务表(无 schema 字段)· Prisma 落库 · 前端接线 |
| task-temp | `apps/api/src/task` | 空闲 | — | — | C1-C5 | — | 临时任务、悬赏冻结 |
| **assignment**(M4) | `apps/api/src/assignment` | 已认领(排队) | 发起人(`buzhunwanyouxi`) | DSH | D1-D5, #12 | 2026-10-20 | **等 M1 完成即可开工**(依赖 `TaskInstance`)。抢单 / 15 分钟无责退单 / 弃单计数 / 兜底指派。拆分见 `MVP-MODULES.md` → M4 |
| scoring(M5+M6 排队) | `apps/api/src/scoring` | 已认领(排队) | 发起人(`buzhunwanyouxi`) | DSH | E1-E14, #13, #14 | 2026-10-20 | `settle()` 纯函数 + **8 用例**(已完成)。**M5 评分 / M6 结算排队中,依赖 M1**。**任何人不得另写第二份结算实现**。落库与 #13/#14 路由未做 |
| **media-proof** | `apps/api/src/media` | **已完成**(#10 上下两半) | 发起人(`buzhunwanyouxi`) | DSH | D6-D9 | 2026-10-16 | 7 源文件 / 4 测试文件 / **53 用例**,另有 `routes/media*.test.ts` **18 用例**。**已完成**:D7 校验(魔数判类型)· 上传 #10 · 读取 + 签名 URL · 72h 到期在**读取时**判定 · 真实浏览器验证。**未做**:持久化存储 · `Range` 请求 · 视频时长校验 · 过期删除调度器 |
| **points** | `apps/api/src/points` | **已完成**(#15) | 发起人(`buzhunwanyouxi`) | DSH | F1-F8 | 2026-10-16 | 2 源文件 / 2 测试文件 / **29 用例**。**已完成**:`ledger.ts` 三数·冻结·恒等(22)· `view.ts` + #15 查询接口。**未做**:Prisma 落库 · `PointsTxn` 流水写入 · J7 对账 |
| wish | `apps/api/src/wish` | 空闲 | — | — | G1-G8 | — | 愿望·定价·众筹·兑现。`Wish` 表 2 引用,`WishContribution` **0 引用** |
| notify | `apps/api/src/notify` | 空闲 | — | — | H1-H8 | — | 微信模板消息 / 短信 / 红点。**当前所有通知只靠 GitHub 邮件** |
| report | `apps/api/src/report` | 空闲 | — | — | I1-I6 | — | 贡献占比·月度报告 |
| shared | `packages/shared` | 空闲 | — | — | — | 2026-10-16 | **共享文件,改动前先在日志里声明**。当前仅 `constants.ts` / `types.ts` / `index.ts` |
| **web-app** | `apps/web` | **进行中** | 发起人(`buzhunwanyouxi`) | DSH | P01-P19 | 2026-10-16 | 骨架 + API 客户端 + 登录·建家·首页·邀请卡片。**已有 13 个用例**(含真实后端冒烟 10 个)。⚠️ **#15 积分与 #10 上传尚未接到界面** —— 后端已就绪,前端仍未调用 |
| infra | 根目录 / `.github` | **已完成**(CI) | 发起人(`buzhunwanyouxi`) | DSH | 第 10 章 | 2026-10-16 | **CI 已上线并连续 4 次全绿**(`.github/workflows/ci.yml`):类型检查 / 测试 / 构建 / 协作机制自检。**未做**:部署·备案·备份 |
| docs | `docs/` | **进行中**(规则维护) | 发起人(`buzhunwanyouxi`) | DSH | 第 14 章 | 2026-10-16 | 规则文档维护(**改规则必须人类拍板**,见 `AGENTS.md` 禁令 8)。2026-10-16 采纳 spec-gap #3:第 12 步扩为「验证输出 + 移出 PENDING + 同步 OWNERS」,并给本表加「最后更新」列;收工清单从 5 项扩到 6 项且由 `sync:inbox:check` 强制三处一致 |

---

## 子模块拆分建议(2026-10-12 新增,依据一次真实冲突事故)

> **为什么要拆到这么细**:实测发现,两位协作者各自"按模块"认领、都守规矩,合并时仍在 4 个文件上冲突。
> 「模块」这个粒度太粗 —— **同一模块的不同层被两个人先后改到,一样会撞**。
> 认领时请填到**子模块**这一级,规则见 `docs/PROJECT_GUIDE.md` 14.5「规则 0」。

| 模块 | 可单独认领的子模块 |
|---|---|
| `auth` | `app`(路由装配与类型)· `service` · `password` · `jwt` · `middleware` · `repository`(内存) · `repository.prisma` · `errors` · `tests` |
| `family` | `app` · `service` · `invite` · `directory` · `repository` · `repository.prisma` · `errors` · `tests` |
| `media-proof` | `expiry`(纯逻辑,**已完成**)· `upload` + `access`(**已完成**)· `storage`(**待认领**:持久化适配器)· `cron`(**待认领**:J4 过期清理 / J5 到期提醒)· `range`(**待认领**:视频拖动)· `tests` |
| `points` | `ledger`(纯逻辑,**已完成**)· `view` + `routes`(#15,**已完成**)· `prisma`(**待认领**:落库)· `txn`(**待认领**:`PointsTxn` 流水写入)· `reconcile`(**待认领**:J7 对账) |
| `web-app` | `client`(API 客户端)· `pages/*` · `components/*` · `router/session` · `styles` · **`points-wire`(待认领:把 #15 接到界面)** · **`upload-wire`(待认领:把 #10 接到相机)** |

**判定标准**:一个子模块若文件数 > 5,或改动会同时跨两层(如既改 HTTP 又改数据库),就继续拆 ——
**拆到"一个人半天能做完"为止。**

---

## ★ 下一步工作的认领清单(2026-10-16 新增;**2026-10-20 改为指向模块划分**)

> **为什么要有这一节**:`CONTRACTS.md` 说 `#11`-`#14` "待认领"、本表说对应模块"空闲"、
> `ROADMAP.md` 负责人写"—" —— **三处都说"没人做",但没有任何机制把它推到人手里。**
>
> ### ⚠️ 2026-10-20 变更:详细拆分已独立成 [`docs/coordination/MVP-MODULES.md`](../coordination/MVP-MODULES.md)
>
> 那份文件把 MVP 缺口拆成 **M1–M6 六个模块**,每个都有:文件清单、依赖、契约编号、
> **做完的判据**、以及**为什么派给那个人**。本表只保留摘要,**冲突时以 `MVP-MODULES.md` 为准**。
>
> **同时定下的分配**:`M1/M3/M4/M5/M6` → 发起人;`M2` → `sun-521-s`;
> **`MIAO98J` 本轮不分配**(原 `#6` family 端口化转入待办池,不做指派)。

| 模块 | 工作 | 依赖 | 负责人 | 详见 |
|---|---|---|---|---|
| **M1** | **`TaskInstance` 地基**:实体 + 仓储 + 唯一状态机 + 2 条读接口 | **无** | 发起人 | `MVP-MODULES.md` → M1 |
| **M2** | **固定任务模板 CRUD**(`#11`,B1–B8) | **无**(可并行) | **`sun-521-s`** | `MVP-MODULES.md` → M2 |
| M3 | J1 每日实例生成(幂等) | M1, M2 | 发起人 | `MVP-MODULES.md` → M3 |
| M4 | 抢单 / 15 分钟无责退单(`#12`) | M1 | 发起人 | `MVP-MODULES.md` → M4 |
| M5 | 评分(`#13`,E1–E6) | M1 | 发起人 | `MVP-MODULES.md` → M5 |
| M6 | **结算 → 写积分流水**(`#14`) | M1, M5 | 发起人 | `MVP-MODULES.md` → M6 |

**关键路径**:`M1 → M4 → M5 → M6`。**没有 M1,积分永远是 0**,MVP 不可能达成。
**M2 是唯一能完全并行的**,所以先派出去。

### 不阻塞 MVP、但仍待办的(发起人排期)

| # | 工作 | 子模块 | 依赖 |
|---|---|---|---|
| 1 | 把 `#15` 接到界面(积分页真查接口) | `web-app` / `points-wire` | 无 |
| 2 | 把 `#10` 接到相机(拍照→压缩→上传→显示) | `web-app` / `upload-wire` | 无 |
| 3 | 持久化存储适配器(实现 `ProofMediaStore`) | `media-proof` / `storage` | 无 |
| 4 | 过期删除调度器(调 `expiry.ts` 的 `planCronPass`) | `media-proof` / `cron` | #3 |
| 5 | `Range` 请求(视频拖动进度条) | `media-proof` / `range` | 无 |

---

## 认领模板(复制到对应行)

```markdown
| media-proof | `apps/api/src/media` | 进行中 | 李四 | Cursor | 2026-03-02 | D6-D9 | 计划 3/5 完成 |
```

## 当前并行建议(避免互相等待)

可以同时开工、互不冲突的组合示例:

- **A 线**:`auth` + `family`(W1 地基)
- **B 线**:`task-template` + `assignment`(W2 任务流转,**注意 B1 只有创始人可写**)
- **C 线**:`media-proof` + `points`(W3 核心闭环,建议由最熟悉规则的人做)
- **D 线**:`web-app` 页面骨架(可与后端并行,但接口以 `CONTRACTS.md` 为准)

⚠️ `packages/shared` 被所有人依赖:**先定契约,再各自实现**。
