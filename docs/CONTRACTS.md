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
| 3 | POST | `/api/auth/register` | `{account, password, nickname}` | `{token, user, families}` | **已定稿(待实现)** | 车道 C 代拟 | 2026-10-10 |
| 4 | POST | `/api/auth/login` | `{account, password}` | `{token, user, families}` | **已定稿(待实现)** | 车道 C 代拟 | 2026-10-10 |
| 5 | GET | `/api/auth/me` | header: Bearer | `{user, families}` | **已定稿(待实现)** | 车道 C 代拟 | 2026-10-10 |
| 6 | POST | `/api/families` | `{name, timezone?}` | `{family, membership}` | **已定稿(待实现)** | 车道 C 代拟 | 2026-10-10 |
| 7 | POST | `/api/families/join` | `{inviteCode, nickname?}` | `{family, membership}` | **已定稿(待实现)** | 车道 C 代拟 | 2026-10-10 |
| 8 | GET | `/api/families` | header: Bearer | `{families:[FamilySummary]}` | **已定稿(待实现)** | 车道 C 代拟 | 2026-10-10 |
| 9 | GET | `/api/families/:fid/members` | header: Bearer | `{members:[MemberSummary]}` | **已定稿(待实现)** | 车道 C 代拟 | 2026-10-10 |
| 10 | POST | `/api/families/:fid/instances/:iid/proof` | multipart:`file` | `{media:ProofMedia}` | **已定稿(待实现)** | 车道 C | 2026-10-10 |
| 11 | POST | `/api/families/:fid/templates` | 固定任务字段 | `{template}` | 待认领 | — | — |
| 12 | POST | `/api/families/:fid/instances/:iid/claim` | — | `{instance}` | 待认领 | — | — |
| 13 | POST | `/api/families/:fid/instances/:iid/scores` | `{percent}` | `{score}` | 待认领 | — | — |
| 14 | POST | `/api/families/:fid/instances/:iid/settle` | `{force?:bool}` | `{percent, points, settledBy}` | 待认领 | — | — |
| 15 | GET | `/api/families/:fid/points/:uid` | — | `{earned, available, spent, frozen}` | 待认领 | — | — |

### 前端调用约定(车道 C 冻结,所有人遵守)

> ⚠️ **实现前必读**:积分四项数值的语义以 `apps/api/src/points/ledger.ts` 顶部注释为准(F6 已于 v1.3 裁决)。
>
> ```
> 累计获得 earned   = 赚取类流水 − 冲正流水          (除 E8 冲正外只增)
> 已消费   spent    = 兑换 + 投入愿望 + 悬赏支付
> 当前可用 available = earned − spent               ← Membership.points 列
> 冻结中   frozen   = available 中被预留的子集      ← 悬赏预留/释放,不动 available
> 当前可花          = available − frozen
> 恒等式(F6):earned − spent === available
> ```
>
> **不要在其他模块另写一套积分口径。** 前端 `apps/web/src/api/types.ts` 与后端 `ledger.ts` 已按此对齐。

前端**只认上面这张表**。为让前端可以在后端未完成时先跑起来,约定如下:

```ts
// 账号:一个字段同时接受手机号与邮箱,由后端判断
type Account = string;

interface UserSummary  { id: string; nickname: string; avatarUrl?: string; phone?: string; email?: string }
interface FamilySummary{ id: string; name: string; role: 'owner'|'admin'|'member'|'child';
                         points: number; earnedPoints: number; spentPoints: number; frozenPoints: number }
interface MemberSummary{ userId: string; nickname: string; avatarUrl?: string;
                         role: 'owner'|'admin'|'member'|'child'; joinedAt: string }
interface AuthResult   { token: string; user: UserSummary; families: FamilySummary[] }
```

1. **路径前缀**:前端所有请求走 `/api/...`(开发环境由 Vite 代理到 `http://localhost:3000`)。
2. **认证**:登录/注册成功后前端把 `token` 存 `localStorage`,后续请求带 `Authorization: Bearer <token>`。
3. **401 的处理**:前端收到 401 一律清除本地 token 并跳回登录页——后端**不要**返回 302 或 HTML。
4. **错误体**:所有失败响应必须是 `{error: string, details?: unknown}`,HTTP 状态码语义化。
5. **`families` 数组**:登录/注册/`me` 三个接口都返回它,前端据此渲染家庭切换器;**没有家庭时返回空数组,不要报错**。
6. **积分三数**:`FamilySummary` 里的 `points / earnedPoints / spentPoints / frozenPoints` 必须同时返回,
   前端首页要显示三个数字(F2),缺字段视为接口未完成。

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
| T3 | `Membership` | 已定稿 | 车道 C(依据 F6 v1.3 裁决) | `(userId,familyId)` 唯一;恒等式 **`earnedPoints − spentPoints = points`**(F6 v1.3),且 **`frozenPoints` 是 `points` 的保留子集**(`0 ≤ frozenPoints ≤ points`)。唯一实现:`apps/api/src/points/ledger.ts`。原注释 `earnedPoints − spentPoints − frozenPoints = points` 已于 v1.3 废止 |
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
