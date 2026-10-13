---
task_id: W1-WIRE
operator: 发起人(buzhunwanyouxi)
ai: DSH (DeepSeek Harness)
date: 2026-10-13 22:00
module: 跨模块装配(composition)+ 协作机制修订
branch: main
status: done
related_requirements: [第 14 章, A1, A2]
---

## 1. 本轮目标(一句话)

合并车道 B 的 PR #2,并修掉它暴露出的**跨模块装配缺口** ——
两个模块各自 new 了一套内存仓储,导致 `POST /api/families` 端到端返回 500,而 215 个单测全绿。

## 2. 变更文件清单

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `apps/api/src/composition.ts` | **新增** | 装配根:一份用户存储 + `createUserSyncingAuthRepository()` 镜像桥 + `familyInviteCode()` 临时读取器 |
| `apps/api/src/composition.test.ts` | **新增** | **跨模块集成测试**(5 个用例):走真实 HTTP,注册 → 建家 → 看成员 → 登录带家庭 |
| `apps/api/src/routes/index.ts` | 修改(**共享**) | `registerRoutes(app, { services?, secret? })`;装配移出本文件;**保留**车道 A/B 的全部注释与理由 |
| `apps/api/src/routes/auth.ts` | 修改(车道 A,**经发起人授权**) | `AuthRoutesOptions` 增加可选 `service?`,与 `registerFamily` 对称;不传时行为完全不变 |
| `AGENTS.md` | 修改 | 第 0 步增加「**查外部事件**」半节(PR / 通知 / 分支 / main 日志) |
| `docs/coordination/README.md` | 修改 | 防失控表增加"合并时衍生文件冲突",并给出三步处置法 |
| `docs/coordination/PENDING.json` | 修改 | `#10b` **升级**为阻塞级;新增 `family-user-directory-port`(给 B)、`add-cross-module-integration-test`;`family-unlock-for-frontend` 去掉 `waiting_on` |
| `docs/ai-logs/INDEX.md` | 修改 | 追加本行 |

**远端操作**:合并 PR #2(`feee55b`),删除已合并分支 `feat/family-create`。

## 3. 接口与数据变更

- **HTTP 接口:无变化。** 路径、入参、出参一律未动,只是它们终于**能跑通**了。
- **模块内部 API(新增,供装配与测试)**:
  - `createAppServices(options): AppServices` —— 唯一装配入口
  - `createUserSyncingAuthRepository(inner, mirror)` —— 把 auth 建的账号镜像给 family
  - `familyInviteCode(repository, familyId)` —— **临时**读取器,`#10b` 落地后应删除
  - `registerRoutes` 新增可选第二参数 `{ services?, secret? }`;`registerAuth` 新增可选 `service?`
- **破坏性变更:无。** 两处新增均为可选参数,既有调用方不受影响。
- **是否更新 CONTRACTS.md:否** —— 契约本来就写对了,错的是装配。**这正说明契约正确不等于实现连通。**

## 4. 尚未完成 / 遗留 TODO

- [ ] `#10b` 邀请码展示接口(**仍未认领**,现已升级为阻塞级 —— 见第 5 节)
- [ ] `family` 改为依赖 `UserDirectoryPort`,以便删掉镜像桥(已指派给 B,登记在 `PENDING.json`)
- [ ] Prisma 真实读写未验证(车道 B 遗留,本轮未动)
- [ ] `media-proof.upload`、`points.prisma` 仍未做

## 5. 阻塞与风险(需要谁配合)

### ★ 发现 1:`#10b` 从"不紧急"升级为**阻塞"加入家庭"整条路**

实测证据(`POST /api/families` 的真实响应):

```json
{"family": {"id": "...", "name": "我们家", "role": "owner",
            "points": 0, "earnedPoints": 0, "spentPoints": 0, "frozenPoints": 0}}
```

`family` 是冻结的 `FamilySummary`,**不含 `inviteCode`**;而 `#10b`(`GET /api/families/:fid/invite`)是唯一读取途径且未实现。
**结论:创始人建完家拿不到邀请码 ⇒ 任何人都无法加入家庭。** 我此前判断它"不紧急"是错的 —— 那条判断基于"前端没调用",
但没意识到**前端不调用正是因为拿不到,而不是不需要**。

### ★ 发现 2:215 个单测全绿,却漏掉一个 500

每个模块的单测都**在自己内部造数据**,所以"模块内正确"完全不能推出"拼起来能跑"。
本轮新增 `composition.test.ts` 走真实 HTTP 链路,以后装配被改坏会立刻红。

### ★ 发现 3:我漏看了车道 B 的 PR 与评审请求,达一小时

**事实**:B 在 13:05 完成 rebase 并请求评审;我在 13:2x 照流程执行"第 0 步"(读收件箱 + 读文档),
**完全不知道这件事**,还在按旧状态安排工作。是你问"你没有收到一个申请合并的 pr 吗"才发现的。

**根因**:收件箱只覆盖"别人写进仓库的需求",**不覆盖别人在 GitHub 上的动作**。
收件箱里的条目是别人**主动登记**的,而 PR/评论/推送是别人**实际做的** —— 两者不是一回事。

**修法**:`AGENTS.md` 第 0 步增加第二半"查外部事件"(open PR / 未读通知 / 分支 sha / main 日志),
并给出判据:**只要判断依赖"别人现在做到哪了",就必须先查这四项。**

### 风险:装配还在共享文件里

`routes/index.ts` 现在只做挂载(注册顺序 + 注释),装配逻辑移到了 `composition.ts`。
但**注册顺序本身仍是有语义的**(auth 必须先装,family 才能用 `requireAuth`),这个约束只靠注释表达,
没有测试。**若有人调换顺序,`registerFamily()` 会抛错拒绝启动** —— 属于"会响亮失败",可接受。

## 6. 如何验证本轮改动

```bash
# 1) 跨模块集成测试(本轮新增,最重要)
pnpm --filter @fcp/api test composition
# 期望:5 passed。它覆盖:注册能用、建家 201、成员昵称来自 auth、登录带家庭列表、构造后注册的账号也能建家

# 2) 全量回归
pnpm -r typecheck && pnpm --filter @fcp/api test
# 期望:3 包 Done;15 文件 / 220 用例全过(此前 14 / 215)

# 3) 真实服务端到端(手动)
pnpm --filter @fcp/api dev
# 注册 → 建家(期望 201,修复前是 500)→ 看成员(期望 200,昵称正确)
# → 登录(期望 families 数量为 1)→ 未加入家庭的人查列表(期望 200 + 空数组,不是报错)
```

实测结果:集成测试 5/5;全量 220/220;真实服务端到端 8 项全绿(详见第 7 节)。

## 7. ★ 给下一个接手者的交接建议

**先读这三个文件,顺序不能反**:

1. `apps/api/src/composition.ts` —— **谁和谁共享什么状态**,全在这里,文件头写了为什么需要它
2. `apps/api/src/routes/index.ts` —— 只有挂载;注释解释了**注册顺序为什么重要**
3. `apps/api/src/composition.test.ts` —— **改装配前先看它**,它会告诉你哪些行为已被钉住

**接着做最省事的顺序**:

1. **`#10b` 邀请码接口**(阻塞"加入家庭"整条路,已升级为最高优先)
   - 形状已冻结:`{inviteCode, inviteExpireAt, qrPayload}`
   - **必须校验调用者是该家庭 owner/admin**,否则任何成员都能把码泄给外人
   - 做完后**把 `composition.ts` 里的 `familyInviteCode()` 删掉**,并把集成测试改成走 HTTP 取码 ——
     这就是它存在的唯一理由,删掉它是"这件事做完了"的标志
2. `family-user-directory-port`(已指派给 B) —— 消掉镜像桥,少一份需要同步的状态
3. `media-proof.upload` + `points.prisma` —— 打通"派任务 → 评分 → 积分"闭环

**别踩的坑**:

- **不要把 `createAppServices()` 的调用挪进某个模块内部**。它之所以独立,就是因为"模块自己 new 仓储"正是这次事故的成因。
- **`registerAuth(app, { service })` 不能再传 `repository`**:传了 `service` 时 `repository` 会被忽略,
  而你会以为自己在共享用户存储。要换存储,改 `createAppServices()` 一处。
- **测试里不要图省事直接 `createAuthService()` / `createFamilyService()`** ——
  那样各建各的存储,又会回到"单测绿、端到端 500"的老路。用 `createAppServices()`。

## 8. ★ 我在别人代码里发现的问题

| 严重度 | 位置 | 问题 | 建议 | 证据 |
|---|---|---|---|---|
| **高** | `docs/CONTRACTS.md` #10b(契约缺口,非某人代码) | `POST /api/families` 返回的 `family` 不含 `inviteCode`,而 #10b 未实现 ⇒ **邀请码无从获取,加入家庭走不通** | 认领 #10b;或明确裁决"邀请码由前端本地生成"(不推荐,那会破坏唯一性校验) | 实测响应见第 5 节发现 1 |
| **中** | `apps/api/src/routes/auth.ts`(车道 A) | `registerAuth` 只接受 `repository` 不接受 `service`,而 `registerFamily` 接受 `service` —— **两个车道注入方式不对称**,导致装配层无法让 auth 用上共享存储 | **已修**(经发起人授权):加可选 `service?`,与 family 对称;不传时行为不变 | 对比两文件 `*RoutesOptions` 定义 |
| **中** | `apps/api/src/family/repository.ts`(车道 B) | 私有用户表只在构造时快照 `options.users`,**构造后注册的账号永远看不见**;且查询是同步的,无法接 async 端口 | 改为依赖 `UserDirectoryPort`(已登记 `PENDING.json`,指派给 B) | 该文件 7 处 `users.has/get/set` |
| **低** | `apps/api/src/family/service.ts`(车道 B) | `createFamilyService({ repository })` 时传入的是**具体内存仓储类型**,装配层因此能拿到 `seedUser` 这类测试辅助方法 —— 生产代码里用它略越界 | 若要长期保留镜像桥,可给镜像目标定义最小接口 `{ seedUser }`;当前已用 `Pick<...>` 收窄 | `composition.ts` 的 `Pick<InMemoryFamilyRepository, 'seedUser'>` |

**给车道 B 的公开评价**:他主动声明了"`server.ts` 里把 `createPrismaFamilyRepository` 接上(现在还是内存仓储)",
**没有隐瞒未完成项**;`Prisma` 路径写法正确(同一张 `User` 表,所以生产模式根本没这个 bug);
并且在收工时**故意不解锁** `waiting_on`(理由是"等的是 PR 合并,不是 rebase"),**准确理解了我设计的语义**。

## 9. 文档同步情况

- [x] `docs/coordination/PENDING.json`(#10b 升级 + 两条新增 + 去掉一条 waiting_on)
- [x] `docs/coordination/README.md`(衍生文件冲突处置法)
- [x] `AGENTS.md`(第 0 步第二半:查外部事件)
- [x] `INDEX.md`(本行)
- [x] `OWNERS.md`(`infra` 行的说明 —— 装配归 infra;见下)
- [ ] `docs/PROJECT_GUIDE.md` —— **本轮未改**:等 `#10b` 落地、"装配归属"在实践中稳定后再写进正式章节
