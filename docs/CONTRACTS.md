# 接口契约总表(CONTRACTS)

> **契约优先于实现。** 跨模块的接口 / 数据表以本文件为唯一事实来源。
> **改接口不改这里 = 本轮工作无效。**
> 共享文件清单(`packages/shared/src/types/**`、`prisma/schema.prisma`、`routes/index.ts`、`constants.ts`、本文件、`package.json`)改动前请在 ops 日志里声明。

## 一、状态图例

| 状态 | 含义 |
|---|---|
| `已定稿` | 可以依赖,实现方与调用方按此编写 |
| `草稿` | 有人正在设计,先别依赖 |
| `待认领` | 规则已明确但还没人实现 |

---

## 二、API 契约

| # | 方法 | 路径 | 入参 | 出参 | 状态 | 定义者 | 最后变更 |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/health` | — | `{ok, service, time}` | 已定稿 | 项目初始化 | 2026-10-10 |
| 2 | POST | `/api/scoring/preview` | `{maxPoints, scores:[{scorerId,isOwner,percent}]}` | `{percent, points, settledBy, provisional, rawPercent, otherScorers}` | 已定稿 | 项目初始化 | 2026-10-10 |
| 3 | POST | `/api/families` | `{name, timezone?}` | `{family, inviteCode}` | 待认领 | — | — |
| 4 | POST | `/api/families/join` | `{inviteCode, nickname}` | `{membership}` | 待认领 | — | — |
| 5 | POST | `/api/families/:fid/templates` | 固定任务字段 | `{template}` | 待认领 | — | — |
| 6 | POST | `/api/families/:fid/instances/:iid/claim` | — | `{instance}` | 待认领 | — | — |
| 7 | POST | `/api/families/:fid/instances/:iid/proof` | multipart 文件 | `{media, expireAt}` | 待认领 | — | — |
| 8 | POST | `/api/families/:fid/instances/:iid/scores` | `{percent}` | `{score}` | 待认领 | — | — |
| 9 | POST | `/api/families/:fid/instances/:iid/settle` | `{force?:bool}` | `{percent, points, settledBy}` | 待认领 | — | — |
| 10 | GET | `/api/families/:fid/points/:uid` | — | `{earned, available, spent, frozen}` | 待认领 | — | — |

**约定**

- 认证:`Authorization: Bearer <jwt>`;所有 `/api/families/:fid/**` 必须校验调用者属于 `:fid`,**跨家庭访问一律 403**。
- 错误:`{error: string, details?: unknown}`,状态码语义化。
- 金额/积分:JSON 数字,保留 2 位小数;百分比为 0-100 整数。

---

## 三、数据表契约

以 `apps/api/prisma/schema.prisma` 为实现,本表只登记**归属与关键约束**。

| # | 表 | 状态 | 负责人 | 关键约束 |
|---|---|---|---|---|
| T1 | `User` | 已定稿 | 项目初始化 | `phone`/`email` 唯一 |
| T2 | `Family` | 已定稿 | 项目初始化 | `inviteCode` 唯一、可设有效期 |
| T3 | `Membership` | 已定稿 | 项目初始化 | `(userId,familyId)` 唯一;恒等式 `earnedPoints − spentPoints − frozenPoints = points`(**F5/F6**) |
| T4 | `TaskTemplate` | 已定稿 | 项目初始化 | **写权限仅 family.owner**(B1,API 层强校验) |
| T5 | `TaskInstance` | 已定稿 | 项目初始化 | 状态机单向流转;`settledBy ∈ owner/others_avg/fallback_60` |
| T6 | `ProofMedia` | 已定稿 | 项目初始化 | **`expireAt` 上传即写死 = uploadedAt + PROOF_TTL_HOURS**;索引 `(expireAt,status)` |
| T7 | `Score` | 已定稿 | 项目初始化 | `(refType,refId,scorerId)` 唯一;`percent ∈ [0,100]` |
| T8 | `PointsTxn` | 已定稿 | 项目初始化 | **只追加**;`earned=true` 才计入"累计获得"(F4) |
| T9 | `Wish` / `WishContribution` | 已定稿 | 项目初始化 | 定价权归创始人/管理员;**分值不可下调** |
| T10 | `Discipline` | 已定稿 | 项目初始化 | 只记录事实,**不扣任何分**;连续 3 次触发 7 天冷静期 |

---

## 四、事件 / 定时任务契约

| # | 作业 | 频率 | 归属模块 | 状态 |
|---|---|---|---|---|
| J1 | `generateDailyInstances` | 每天 00:05 | task-template | 待认领 |
| J2 | `remindUpcoming` | 每 10 分钟 | notify | 待认领 |
| J3 | `settleFallback` | 每小时 | scoring | 待认领 |
| J4 | `expireProofMedia` | **每小时** | media-proof | 待认领 |
| J5 | `remindMediaExpiry` | 每天 2 次 | media-proof | 待认领 |
| J6 | `ownerScoreDigest` | 每天 1 次 | notify | 待认领 |
| J7 | `reconcilePoints` | 每天 03:00 | points | 待认领 |
| J8 | `monthlyReport` | 每月 1 日 | report | 待认领 |

> J4 是本项目最容易被漏掉、后果最严重(存储泄漏 / 隐私事故)的作业:
> **删除前必须确认该任务已结算**(PROJECT_GUIDE 4.10 前置条件),且删除操作必须幂等。

---

## 五、共享文件清单(串行修改)

改动以下文件前,请在当轮 ops 日志里声明,并在同一轮更新本文件:

```
packages/shared/src/types/**
packages/shared/src/constants.ts
apps/api/prisma/schema.prisma  (+ migrations/)
apps/api/src/routes/index.ts
docs/CONTRACTS.md
package.json, pnpm-lock.yaml
```
