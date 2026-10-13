---
task_id: W1-B2
operator: 喵(MIAO98J)
ai: DSH (DeepSeek Harness)
date: 2026-10-12 21:30
module: family
branch: feat/family-create
status: done
related_requirements: [A2, A4, A5, A6]
---

## 0. 更正说明(针对本分支上一轮的日志)

> **更正说明:原文件 `docs/ai-logs/ops/2026-10-11-1930_W1-B_family.md` 有两处已过时,以本文件为准。**
> 日志只追加不改写,所以原文保持原样,不回去修改它:
>
> 1. 原文 **3.2 节**说"认证守卫在请求期解析,车道 A 未合并时四个接口回 `503 auth_unavailable`" ——
>    **已作废**。车道 A 已合并进 `main`,本轮改为契约规定的写法(复用 `app.requireAuth` +
>    `currentUserId`);503 分支与 `auth_unavailable` 错误码**已删除**,`registerFamily()` 在
>    `app.requireAuth` 缺失时**直接抛错拒绝启动**。
> 2. 原文 **第 6 节**里"期望 503 auth_unavailable"的手工验证步骤同理作废。
> 3. 原文第 2 节的变更文件清单是 18 个;合并后本 PR 共 **20 个**文件(见下节)。

## 1. 本轮目标(一句话)

把 `feat/family-create` rebase 到已含车道 A `auth` 的 `main`,并趁机把上一轮为"跨车道时序"打的
三段桥接(503 回退、本地认证上下文、假守卫测试)**换成契约里写的正式实现**。

## 2. 变更文件清单(20 个,每个都列)

**本轮新增(2)**

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `docs/ai-logs/ops/2026-10-12-2130_W1-B2_family-integration.md` | 新增 | 本文件 |
| `docs/ai-logs/reports/2026-10-12-2130_W1-B2_family-integration.md` | 新增 | 对应报告 |

**上一轮已提交、本轮内容有改动(6)**

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `apps/api/src/routes/family.ts` | 修改 | **删掉 503 桥接**,改为 `import { currentUserId }` + `app.requireAuth`;守卫缺失时抛错 |
| `apps/api/src/family/http.test.ts` | 修改 | 改为**真实跨模块端到端**(真 `registerAuth` + 真注册拿 token),新增 3 个交接用例 |
| `apps/api/src/family/errors.ts` | 修改 | 删除已无人使用的 `auth_unavailable` 错误码 |
| `apps/api/src/routes/index.ts` | 修改 | **共享文件**:保留车道 A 的 `registerAuth`,追加 `registerFamily`,并完成 `familyDirectory` 交接 |
| `docs/CONTRACTS.md` | 修改 | 以 `main` 为基础合并(见第 3.4 节);#6-#9 置已实现;新增「family 模块交付说明」与「变更登记」 |
| `docs/ai-logs/OWNERS.md` | 修改 | `family` 行更新为已完成并写明交付范围 |

**上一轮已提交、本轮逐字未改(11)**

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `apps/api/src/family/types.ts` | 新增 | 领域类型 + 持久化端口 |
| `apps/api/src/family/invite.ts` | 新增 | 邀请码纯逻辑 |
| `apps/api/src/family/repository.ts` | 新增 | 内存仓储 |
| `apps/api/src/family/repository.prisma.ts` | 新增 | Prisma 适配器(结构化类型) |
| `apps/api/src/family/service.ts` | 新增 | 四个用例 + 四数原样转发 |
| `apps/api/src/family/directory.ts` | 新增 | `FamilyDirectoryPort` 实现 |
| `apps/api/src/family/index.ts` | 新增 | 模块公开面 |
| `apps/api/src/family/invite.test.ts` | 新增 | 24 个用例 |
| `apps/api/src/family/service.test.ts` | 新增 | 34 个用例 |
| `apps/api/src/routes/family.ts` | 新增 | 见上表(内容本轮有改动) |
| `docs/ai-logs/INDEX.md` | 修改 | 在 `main` 版基础上追加本轮一行 |
| `docs/ai-logs/ops/2026-10-11-1930_W1-B_family.md` | 新增 | 上一轮日志(**刻意未改**,更正说明见第 0 节) |
| `docs/ai-logs/reports/2026-10-11-1930_W1-B_family.md` | 新增 | 上一轮报告(**刻意未改**) |

**未改动**:`packages/shared/**`、`apps/api/prisma/schema.prisma`、`apps/api/src/scoring/**`、
`apps/api/src/media/**`、`apps/api/src/points/**`、`apps/web/**`、`package.json`、`pnpm-lock.yaml`、
`apps/api/src/auth/**`(**车道 A 的目录,一行未碰**)。

## 3. 本轮的三处实质变更(★ 其他 AI 最需要看的部分)

### 3.1 复用车道 A 的中间件,删掉 503 桥接

上一轮的 503 是**只有车道 A 未合并时才成立**的权宜之计。A 合并后它变成死代码,而且会让读者以为
"family 路由可能没有鉴权"。现在按 CONTRACTS「auth 模块交付说明」的写法:

```ts
import { currentUserId } from '../auth/index.js';
app.get('/families/:fid/members', { preHandler: requireAuth }, async (request, reply) => {
  const me = currentUserId(request);
  ...
});
```

`requireAuth` 在**注册期**从 `app.requireAuth` 取;**取不到就抛错拒绝启动**,而不是退化成"没有钩子"
(Fastify 对 `undefined` 的 preHandler 就是当没有,那会让四个接口变成公开)。因此
`registerFamily()` 必须在 `registerAuth()` **之后**调用,`routes/index.ts` 里的顺序是有意义的,
不要调换。

### 3.2 完成 `FamilyDirectoryPort` 交接(上一轮的 TODO 已销)

`routes/index.ts` 现在:

```ts
const familyService = createFamilyService();
await registerAuth(app, { familyDirectory: createFamilyDirectory(familyService) });
await registerFamily(app, { service: familyService });
```

服务在这里构造而不是在 `registerFamily()` 内部,是因为**车道 A 与 family 路由必须共用同一个实例**。
效果:`POST /api/auth/register`、`POST /api/auth/login`、`GET /api/auth/me` 三处的 `families`
不再是恒定的 `[]`,而是真实家庭列表。**这条链路由 3 个新用例覆盖**(见 3.3),接线断掉会立刻红。

### 3.3 测试从"假守卫"升级为**真实跨模块端到端**

`http.test.ts` 以前自己伪造一个 `requireAuth`;现在它按 `routes/index.ts` 的真实顺序装配
lane A 的 `registerAuth` + lane B 的 `registerFamily`,并且**通过真的 `POST /api/auth/register`
拿 token**。新增的交接用例:

1. 新注册账号 `families === []`,不报错(契约规则 5);
2. 建家之后 `GET /api/auth/me` 的 `families` 里出现这个家庭(交接真的通了);
3. 四数 `42.4 / 86.4 / 44 / 5` 一路穿过 auth 原样到达前端(auth 不参与计算)。

另有一个用例专门验证"**先装 family 再装 auth 会被拒绝**"——把"顺序写错就变成公开接口"这个风险钉死。

> 测试里的一个真实限制:两个模块的内存仓储**是两个独立存储**(生产共用同一个数据库),
> 所以用例里注册完账号后要 `repository.seedUser(...)` 把账号同步给 family 仓储。
> 这是测试专用动作,已在注释里写明。

### 3.4 rebase 的冲突解法(逐文件)

| 文件 | 冲突 | 解法 |
|---|---|---|
| `docs/CONTRACTS.md` | 会冲突 | 以 **`main` 为基础**,只叠加自己独有的部分(见下) |
| `apps/api/src/routes/index.ts` | 会冲突 | **两边都留**:车道 A 的 `registerAuth` + 本轮 `registerFamily` |
| `docs/ai-logs/INDEX.md` | 会冲突 | 用 **`main` 版**(发起人已替我加了 W1-B 行),再追加本轮一行 |
| `docs/ai-logs/OWNERS.md` | 会冲突 | 用 **`main` 版**,但**必须把 `family` 那一行换成我的版本**(见下) |

`CONTRACTS.md` 的具体取舍:

- **保留 `main` 的**:#3-#5 三行(已实现 / 车道 C 冻结 + 车道 A 实现)、「邀请码规范」整节、
  「auth 模块交付说明」整节、「前端调用约定」第 4 条、新增的 **#10b**(`GET /api/families/:fid/invite`)、
  T3 的 v1.3 恒等式、车道 A 的共享文件改动声明。
- **用我的版本**:#6-#9 四行状态 → `已定稿(已实现 201 / 200 幂等)`。
- **新增**:「family 模块交付说明」小节 +「变更登记」表。

> ⚠️ **两处与协调者给的步骤不同,是我有意为之,请 review 时确认:**
>
> 1. **`OWNERS.md` 不能整份用 `main` 版**。协调者说"你的 family 认领行已在里面了",这**只对了一半**:
>    `main` 上那一行仍是 `**进行中**`、AI 工具 `—`、需求 `A2, A4-A7`,备注还是"实现进行中"。
>    整份取 `main` 会**悄无声息地丢掉本轮的状态更新**(`已完成` + DSH + 交付范围),而协调者给的
>    自检清单里没有一条能发现它。所以:取 `main` 版,只替换 `family` 一行。
> 2. **我的「family 模块交付说明」已删掉与 `main` 「邀请码规范」重复的内容**。发起人 2026-10-12 已把我
>    report 里的默认值正式登记成「邀请码规范」(6 位 / 32 字符集 / 7 天 / 错误码 / join 幂等 /
>    nickname 语义 / 家庭名长度 / 时区 / 防探测 403)。再复述一遍就是同一事实两个出处,
>    将来必然改一处忘一处。所以我的小节只留:状态码、错误码增量、积分只转发、跨模块交接,
>    并**显式指向**「邀请码规范」。

## 4. 尚未完成 / 遗留 TODO

- [ ] **A6 / A7**(共同管理员、移除成员、创始人转移、注销):未做。
- [ ] **A8 子女 PIN 登录**(W1-02):未做。需要新的"邀请即归属"流程。
- [ ] **#10b `GET /api/families/:fid/invite`**(邀请码展示 + 二维码):发起人已登记进契约表,
      状态"待认领",**不在任何人的模块里**。车道 B 可以做,但需要先认领。
- [ ] **Prisma 接线**:`registerRoutes()` 里目前用的是 `createFamilyService()` 的默认内存仓储,
      auth 侧同理。`pnpm db:generate` + `DATABASE_URL` 就绪后应改为
      `createFamilyService({ repository: createPrismaFamilyRepository(prisma) })`,
      auth 侧用同一个 `prisma`。**本轮没有真实数据库可跑,`repository.prisma.ts` 仍只是类型级检查。**
- [ ] **`NICKNAME_MAX_LENGTH` 的重复定义**:`family/service.ts` 里那份应换成车道 A 的
      `auth/identifiers.ts` 导出的常量(今天 UI 从不发 `nickname`,影响面为零)。
- [ ] **`packages/shared` 上收**:`FamilySummary` / `MemberSummary` 目前有三份声明
      (auth / family / web)。三条车道都稳定后统一上收。

## 5. 阻塞与风险(需要谁配合)

- **风险 A(注册顺序)**:`registerFamily()` 必须在 `registerAuth()` 之后。顺序写反会**启动即失败**
  (刻意如此),不会静默降级。改 `routes/index.ts` 的人请留意这 4 行注释。
- **风险 B(共享文件)**:`routes/index.ts` 与 `docs/CONTRACTS.md` 本轮都动过,已在 CONTRACTS §5
  与「变更登记」表里登记。车道 C 接下来做 #10b 或 media 时会在同一个文件继续叠加。
- **风险 C(真库未验证)**:见 TODO 第 4 条。内存仓储与 Prisma 适配器**行为等价只是设计意图**,
  没有实测过。
- **风险 D(测试的内存账号同步)**:见 3.3 的引用块。若将来把两个内存仓储合并,这段测试脚手架可以删掉。

## 6. 如何验证本轮改动(给下一位 AI)

```bash
pnpm install
pnpm -r typecheck              # 期望:packages/shared / apps/api / apps/web 三包 Done
pnpm --filter @fcp/api test    # 期望:14 个文件、215 个用例全过(车道 A 的 136 + 本模块 79)
```

> ⚠️ 在 DSH 的 workspace-write 沙箱里跑测试会撞 `spawn EPERM`(vitest 底层的 esbuild 必须 spawn
> 子进程 + 管道 stdio,这是沙箱边界,不是代码问题)。需要提权或换机器。

手工验证(**这次不需要任何桩:auth 已在 `main` 上**):

```bash
$env:JWT_SECRET='local-verification-secret'; $env:PORT='3000'
pnpm --filter @fcp/api exec tsx src/server.ts

# 1) 注册,拿到 token(注意响应里 families 是 [])
curl -X POST http://127.0.0.1:3000/api/auth/register -H "content-type: application/json" \
  -d '{"account":"13800138000","password":"a-good-password","nickname":"爸爸"}'
# 2) 建家 → 201,响应含 family(role=owner)+ membership
curl -X POST http://127.0.0.1:3000/api/families -H "authorization: Bearer <token>" \
  -H "content-type: application/json" -d '{"name":"我们家"}'
# 3) 再看 me → families 里应该有刚才那个家(这一步就是交接是否真的通了)
curl -H "authorization: Bearer <token>" http://127.0.0.1:3000/api/auth/me
# 4) 不带 token → 401 JSON(不是 302 / HTML)
curl -i http://127.0.0.1:3000/api/families
```

## 7. 文档同步情况

- [x] `CONTRACTS.md`(以 `main` 为基础合并;#6-#9 已实现;「family 模块交付说明」;「变更登记」)
- [x] `OWNERS.md`(`family` → 已完成 + 交付范围)
- [x] `INDEX.md`(追加本轮一行;保留 `main` 的 W1-B / W1-01 / W1-REVIEW 行)
- [ ] `ROADMAP.md`:**仍未动**。W1-03~W1-06 的负责人列是 `—`,与 OWNERS 不一致,这不是我一个人能定的。
- [ ] `PROJECT_GUIDE.md`:无规则变更,不需要动。
