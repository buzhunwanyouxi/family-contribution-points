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
| 3 | POST | `/api/auth/register` | `{account, password, nickname}` | `{token, user, families}` | **已定稿(已实现)** | 车道 C 冻结 / 车道 A 实现 | 2026-10-10 |
| 4 | POST | `/api/auth/login` | `{account, password}` | `{token, user, families}` | **已定稿(已实现)** | 车道 C 冻结 / 车道 A 实现 | 2026-10-10 |
| 5 | GET | `/api/auth/me` | header: Bearer | `{user, families}` | **已定稿(已实现)** | 车道 C 冻结 / 车道 A 实现 | 2026-10-10 |
| 6 | POST | `/api/families` | `{name, timezone?}` | `{family, membership}` | **已定稿(待实现)** | 车道 C 代拟 | 2026-10-10 |
| 7 | POST | `/api/families/join` | `{inviteCode, nickname?}` | `{family, membership}` | **已定稿(待实现)** | 车道 C 代拟 | 2026-10-10 |
| 8 | GET | `/api/families` | header: Bearer | `{families:[FamilySummary]}` | **已定稿(待实现)** | 车道 C 代拟 | 2026-10-10 |
| 9 | GET | `/api/families/:fid/members` | header: Bearer | `{members:[MemberSummary]}` | **已定稿(待实现)** | 车道 C 代拟 | 2026-10-10 |
| 10 | POST | `/api/families/:fid/instances/:iid/proof` | multipart:`file` | `{media:ProofMedia}` | **已定稿(待实现)** | 车道 C | 2026-10-10 |
| 10b | GET | `/api/families/:fid/invite` | header: Bearer(须为 owner/admin) | `{inviteCode, inviteExpireAt, qrPayload}` | **待认领**(前端 P12 需要,尚未实现) | 车道 C 登记 | 2026-10-12 |
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
4. **错误体**:所有失败响应必须是 `{error: string, message?: string, details?: unknown}`,HTTP 状态码语义化。
   - `error` = **稳定机器码**(如 `user_exists` / `invalid_credentials` / `validation_error`),前端据此做分支判断;
   - `message` = **可直接展示给家人的中文文案**(车道 A 在 #3-#5 首先使用,车道 C 前端已按
     `message ?? error` 渲染)。**新增字段必须是增量**,不得改动或移除既有字段。
5. **`families` 数组**:登录/注册/`me` 三个接口都返回它,前端据此渲染家庭切换器;**没有家庭时返回空数组,不要报错**。
6. **积分三数**:`FamilySummary` 里的 `points / earnedPoints / spentPoints / frozenPoints` 必须同时返回,
   前端首页要显示三个数字(F2),缺字段视为接口未完成。

### 邀请码规范(车道 B 定的默认值,2026-10-12 正式登记进契约)

指导文档 A2 只写了"带有效期",没有写死数字。车道 B 实现时照已上线的前端界面倒推了默认值,
**经发起人确认后正式写入契约**,后续实现一律以此为准:

| 项 | 值 |
|---|---|
| 长度 / 字符表 | **6 位**,字符集 `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`(32 字符,**剔除易混的 `0/1/O/I`**) |
| 有效期 | **7 天**,环境变量 `FAMILY_INVITE_TTL_DAYS` 可覆盖 |
| 大小写 | 输入时统一转大写后再匹配 |
| 错误码 | 邀请码不存在**或格式非法** → `404 invalid_invite_code`(**同一个码,防止探测某码是否存在**);已过期 → `400 invite_expired` |
| `join` 幂等 | 重复加入返回 **200** + 既有 `{family, membership}`,**不报 409** |
| `nickname` 语义 | 传了 `nickname` 会更新 `User.nickname`(表在 `User`,**是全账号改名**,不只对本家庭);今日前端不发送该字段 |
| 家庭名长度 | trim 后 **1–20 个码点**(不是 UTF-16 单元) |
| 时区 | 默认 `Asia/Shanghai`,非法 IANA 名 → `400` |
| 非成员 / 家庭不存在 | **统一回 `403 not_a_member`**,避免用 `:fid` 探测家庭是否存在 |

> ⚠️ **邀请码展示接口尚未实现**:前端 P12 需要 `GET /api/families/:fid/invite`(见上表 #10b),
> 当前**不在任何人的模块里**。要做的先认领 #10b,不要顺手在别处加接口。

### auth 模块交付说明(#3-#5 已实现,车道 A)

实现落点:`apps/api/src/auth/**`(23 个文件,91 个用例)+ `apps/api/src/routes/auth.ts`。
三条接口的**成功响应严格等于上表形状**,不额外返回 `expiresAt` / `expiresIn`。

**错误响应**:按本文件「前端调用约定」第 4 条 —— 该条已由车道 C 在 `94cc7e1` 正式冻结为
`{error, message?, details?}`,`message` 是**可选增量字段**,不得改动或移除既有字段。

```jsonc
{ "error": "user_exists",           // 稳定机器码:validation_error | user_exists | invalid_credentials | unauthorized
  "message": "该手机号或邮箱已注册",   // 中文文案,给 UI 直接显示
  "details": [ /* 仅 validation_error 时存在 */ ] }
```

- 车道 A 是第一个使用 `message` 的模块;**车道 C 已在 `de78d82` 把前端 `client.ts` 改为
  `message ?? error` 渲染,因此无需任何后续改动**。

**跨模块联动接口(车道 B / C 直接复用,不要重复实现)**

```ts
// 保护你模块的接口(认证中间件已在根实例上装好)
app.get('/api/families/:fid/members', { preHandler: app.requireAuth }, async (request) => {
  const me = currentUserId(request);            // 已验签的 userId
  const payload = currentTokenPayload(request); // 需要 exp 时用
});
// import { currentUserId, currentTokenPayload } from '../auth/index.js';
```

| 导出 | 说明 |
|---|---|
| `app.auth` | `AuthService {register, login, me, verifyToken}` |
| `app.requireAuth` | preHandler;失败自行回 401(JSON + 中文 message)且**不抛异常** |
| `FamilyDirectoryPort` | **车道 B 需要实现的唯一端口**:`listFamilies(userId) => Promise<FamilySummary[]>` |
| `createPrismaAuthRepository(client)` | 数据库接线点;结构化类型,**不 import `@prisma/client`** |

- **车道 B 的交接动作**:实现 `FamilyDirectoryPort` 一个对象,再由 `routes/index.ts` 传入
  `registerAuth(app, { familyDirectory })`。**未接线时 `families` 恒为 `[]`**(契约规则 5),不会 500。
- **auth 绝不计算积分**:`families` 里的四项数值由车道 B 提供、auth 原样转发。
  唯一口径实现是 `apps/api/src/points/ledger.ts`(F5/F6 v1.3)。
- **`fastify` 的模块增强由 `apps/api/src/auth/types.ts` 独占**(`app.auth` / `app.requireAuth` /
  `request.authUser`),其他模块不要重复声明。

**约定**

- 认证:`Authorization: Bearer <jwt>`;所有 `/api/families/:fid/**` 必须校验调用者属于 `:fid`,**跨家庭访问一律 403**。
- 错误:`{error: string, message?: string, details?: unknown}`,状态码语义化。
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

> **本轮共享文件改动声明(车道 A,W1-01,2026-10-10 22:50)**
> - `apps/api/src/routes/index.ts` —— 新增 1 行 `await registerAuth(app);`,并为车道 B / C 留下
>   注释形式的注册位(其文件尚不存在,现在写进去会让 `pnpm -r typecheck` 在 `main` 上失败)。
> - `docs/CONTRACTS.md`(本文件)—— 更新 #3-#5 状态、新增「auth 模块交付说明」小节、追加本声明。
> - **未改动**:`packages/shared/**`、`schema.prisma`、`apps/web/**`、`package.json`、`pnpm-lock.yaml`。
>
> **本节曾提出的一处问题已由车道 C 解决**:第三节 **T3** 的恒等式注释过去是旧 F6
> (`earnedPoints − spentPoints − frozenPoints = points`),与 v1.3 裁决矛盾;
> 车道 C 已在 `de78d82` 改为 `earnedPoints − spentPoints = points`(F6 v1.3),
> 并把 `frozenPoints` 明确为 `points` 的保留子集。详见
> `docs/ai-logs/ops/2026-10-10-2250_W1-01_auth.md` 第 5 节风险 E。
>
> **本条目的 rebase 记录**:本分支已于 2026-10-10 对 `origin/main`(`f0ed848`)执行 rebase;
> `docs/CONTRACTS.md` 两侧改动落在文件不同区域,git 未产生冲突。
> 我方改动(#3-#5 状态、交付说明小节、本声明)与车道 C 的改动
> (「前端调用约定」第 4 条错误信封、T3 恒等式行)**均已保留**。
