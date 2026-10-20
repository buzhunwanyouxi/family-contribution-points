---
task_id: W1-M1-INSTANCES
operator: 发起人(buzhunwanyouxi)
ai: DSH (DeepSeek Harness)
date: 2026-10-20 22:30
module: instances(M1 · TaskInstance 地基)
branch: main
status: done
related_requirements: [D1, D2, D3, #16, #17]
---

## 1. 本轮目标(一句话)

M1:`TaskInstance` 从"schema 里有个模型、代码里 0 引用",变成**有状态机、有双仓储、有读接口**的可用模块 ——
并把 media 模块那个占位文件彻底删掉。

## 2. 变更文件清单

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `apps/api/src/instances/types.ts` | **新增** | `TaskInstanceRecord`、`InstanceStatus`、`InstanceRepository`(**含 compare-and-set 方法**) |
| `apps/api/src/instances/errors.ts` | **新增** | 6 个可执行错误码 |
| `apps/api/src/instances/state.ts` | **新增** | **状态机唯一实现** + D2 15 分钟窗口 + D3 到期判定 |
| `apps/api/src/instances/service.ts` | **新增** | 用例层:claim / abandon / transition |
| `apps/api/src/instances/repository.ts` | **新增** | 内存实现 |
| `apps/api/src/instances/repository.prisma.ts` | **新增** | Prisma 实现(`updateMany` + count 实现 CAS) |
| `apps/api/src/instances/index.ts` | **新增** | 对外导出 |
| `apps/api/src/instances/state.test.ts` | **新增** | 25 用例 |
| `apps/api/src/instances/service.test.ts` | **新增** | 20 用例 |
| `apps/api/src/routes/instances.ts` | **新增** | `#16` / `#17` 两个读接口 |
| `apps/api/src/routes/instances.test.ts` | **新增** | 8 用例(含"路由在契约位置上"那条) |
| `apps/api/src/routes/index.ts` | 修改(共享) | 挂载 `registerInstances`(在 media **之前**) |
| `apps/api/src/composition.ts` | 修改 | 新增 `instanceService` / `instanceRepository`;**删掉占位 `instanceStore`** |
| `apps/api/src/media/instances.ts` | **删除** | 占位文件,职责移交真实模块 |
| `apps/api/src/media/upload.test.ts` | 修改 | 改用本地 5 行 fake,不再依赖占位 |
| `apps/api/src/routes/media.test.ts`、`media-read.test.ts` | 修改 | fixture 改走真实 `instanceRepository` |
| `docs/CONTRACTS.md` | 修改(共享) | 新增 `#16`/`#17` 及**状态机全文** |
| `docs/ai-logs/OWNERS.md` | 修改 | M1 → 已完成 |
| `docs/coordination/MVP-MODULES.md` | 修改 | M1 标完成 + **补 P1/P2/P3 三条硬缺口** |

## 3. 接口与数据变更

- **新增接口**:`#16` `GET /api/families/:fid/instances?date=YYYY-MM-DD`、`#17` `GET .../instances/:iid`
- **状态机(冻结)**:

```
open → claimed → doing → pending_score → done
                                     ↘ rejected
任意未结算 → abandoned
终态(done/rejected/abandoned)不得再流转
```

- **数据表变更:无。** 用的是既有的 `TaskInstance` 模型。
- **破坏性变更:无。**(`media/instances.ts` 是内部占位,不在契约里)

## 4. 尚未完成 / 遗留 TODO

- [ ] **M3 每日生成**:有实例了,但**还没有东西会创建它** —— 目前只能靠测试/种子造
- [ ] M4 抢单路由(`#12`):服务层 `claim` 已就绪,**HTTP 层未做**
- [ ] M5 评分(`#13`)、M6 结算(`#14`)
- [ ] **P1 持久化**、**P2 前端接线**、**P3 通知**(见 `MVP-MODULES.md` 第 4 节)

## 5. 阻塞与风险(需要谁配合)

### ★ 发现 1:"传一个 status"的接口是错的设计

第一版我打算让 `InstanceRepository.update(instanceId, { status })` 通用更新。
写测试时立刻发现:那样**两个并发 claim 都会成功** —— 因为读-改-写之间没有保护。

**改法**:仓储只暴露 `claimIfOpen` / `settleIfPending` / `updateStatus(id, expected, next)` ——
**强制调用方说出"我认为它现在是什么状态"**。这样并发下第二次写会返回 `null`,服务层翻译成 409。

> **这条的价值**:内存模式没有真实并发,所以**如果接口设计错了,本地测试永远发现不了**。
> 我在 Prisma 适配器里用 `updateMany + count` 实现同样的语义,
> 就是为了让两个适配器**在"竞争"这件事上行为一致**。

### ★ 发现 2:`this.findById` 是个定时炸弹

Prisma 适配器内我最初用 `this.findById(...)`。类型检查通过、测试通过,**但它会炸**:
一旦有人写 `const { claimIfOpen } = repo`,`this` 就是 `undefined`。

**已改为局部函数**。类里的 `this` 在对象字面量 + 解构场景下没有任何保障。

### ★ 发现 3:终态 → 终态必须区分"同态幂等"

写测试断言时我写了 `expect(...).toEqual({ ok: true })`,实际返回 `{ ok: true, kind: 'noop' }`。
**是测试写错,不是实现错** —— 但这提醒一件事:
**`same → same` 必须是 `noop` 而不是拒绝**,否则前端双击按钮会看到一个"状态已变"的错误,
而实际上什么都没错。这条已写成独立测试。

### 风险:内存模式无法验证真实的并发

`service.test.ts` 里那条"并发抢同一实例只有一个成功"用的是 `Promise.allSettled`,
在 Node 单线程下**两个 claim 实际上是串行的** —— 它证明的是"第二个会拿到 409",
**不是**"数据库层面不会双写"。

后者只能在 P1 落库后用真实并发压测验证。**已写进第 8.5 节。**

## 6. 如何验证本轮改动

```bash
pnpm --filter @fcp/api test instances     # 期望:53 passed(25 state + 20 service + 8 HTTP)
pnpm -r typecheck && pnpm -r test          # 期望:api 25 文件 351 用例;web 2 文件 13 用例
```

**实测**:instances 53/53;全量 **351 + 13 = 364** 前绿;3 包 typecheck Done。

**路由表**(`printRoutes`)确认挂载位置:

```
└── /api/families
    ├── /:fid/instances (GET, HEAD)
    │     └── /:iid/proof (POST)
    └── /:fid/points/:uid (GET, HEAD)
```

## 7. ★ 给下一个接手者的交接建议

**先读两个文件**:

1. `apps/api/src/instances/state.ts` —— **状态机的唯一实现**。任何路由想改 status 都要走它
2. `apps/api/src/instances/types.ts` 的 `InstanceRepository` —— **注意它是 compare-and-set 接口**,
   不是普通的 CRUD。加新方法时**不要**退化成"传一个 patch"

**接着做**:**M3**(每日生成)。判据写在 `MVP-MODULES.md`。
M3 的第一条判据是**幂等**:同一天跑两次,实例数不变。别省这条 ——
定时作业重复执行是常态(重试、多实例部署)。

**别踩的坑**:

- **不要让路由直接 `update({status})`**。所有状态变更走 `service.ts`。
- **新增仓储方法时保持 CAS 形态**。`update(id, patch)` 看起来更方便,但会让并发保护消失。
- **`date` 是 `YYYY-MM-DD` 字符串,不是时间戳**。实例属于"哪一天",而"哪一天"在不同时区不一样。
  Prisma 适配器里的 `dateToRow` / `dateFromRow` 是唯一转换点。
- **`media/instances.ts` 已删除**。如果有人还在 import 它,说明本地有未更新的分支。

## 8. ★ 我在别人代码里发现的问题

**无新增。**

**一处我自己造成的债,本轮还清了**:`media/instances.ts` 是我在 M1 开工前造的占位,
当时在文件头写明"任务模块落地后删掉它"。**本轮删了**,并且 media 改为经 `InstanceReader` 端口
读真实实例 —— 端口只有 3 个字段,不给 media 任何 claim/settle 的能力。

## 8.5 ★ 本轮**未验证**的维度

**我排除的维度(排除 + 依据)**:

- **Prisma 适配器的真实行为**:依据 = 仓库没有数据库、没有 migrations(P1),**无法运行**。
  这是本轮最大的"写了但没跑过"代码 —— 已在 `MVP-MODULES.md` 第 4 节标为 P1
- **真实并发**:依据 = 内存模式无法模拟数据库级竞争。见第 5 节风险

**我根本没测的维度(没碰 + 漏了会怎样)**:

- **★ `repository.prisma.ts` 一次都没执行过**:0 测试、0 运行。
  漏了会怎样 = **它可能根本跑不通**(字段名错、`updateMany` 返回值形状不对),
  而 P1 那天才发现 —— 那时它已经在关键路径上了
- **★ `date` 的时区语义**:我用 `T00:00:00.000Z` 存,用 `toISOString().slice(0,10)` 读。
  对 `Asia/Shanghai` 的用户,"今天"与 UTC 的"今天"差 8 小时。
  漏了会怎样 = **晚上 8 点后创建的任务可能被归到"明天"**
- **家庭时区字段没有用上**:`Family.timezone` 存在,但 M1 完全没有读它
- **超时释放(D3)**:`isOverdue` 有测试,但**没有任何东西调用它**
- **前端能不能用这两个接口**:本轮只做后端;前端接线是 P2

## 9. 文档同步情况

- [x] `CONTRACTS.md`(`#16`/`#17` + 状态机全文)
- [x] `docs/ai-logs/OWNERS.md`(M1 已完成)
- [x] `docs/coordination/MVP-MODULES.md`(M1 标完成 + **补 P1/P2/P3**)
- [x] `INDEX.md`(本行)
- [ ] `ROADMAP.md` —— **未改**:`W2-01/W2-02` 仍标 ⬜,但它们是"模板 + 生成",
      M1 只是地基,`W2-02`(每日生成)确实还没做。等 M3 完成再勾
