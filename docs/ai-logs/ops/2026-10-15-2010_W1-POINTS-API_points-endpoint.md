---
task_id: W1-POINTS-API
operator: 发起人(buzhunwanyouxi)
ai: DSH (DeepSeek Harness)
date: 2026-10-15 20:10
module: points(实现 CONTRACTS #15 积分查询)
branch: main
status: done
related_requirements: [F1-F8]
---

## 1. 本轮目标(一句话)

实现 `#15` —— `GET /api/families/:fid/points/:uid`:把成员的四个积分数字从 `Membership` **原样转发**出去,
让前端首页能画出来(F2),并守住"口径只有一份实现"这条铁律。

## 2. 变更文件清单

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `apps/api/src/points/view.ts` | **新增** | 纯映射:`Membership` 四数 → 契约 #15 的响应形状 |
| `apps/api/src/points/view.test.ts` | **新增** | 7 个用例,含"不许成为第二份口径实现"的断言 |
| `apps/api/src/routes/points.ts` | **新增** | HTTP 层 + 授权 + 防探测 |
| `apps/api/src/routes/index.ts` | 修改(共享) | 挂载 `registerPoints`(**在 registerAuth 之后**,它要用 `app.requireAuth`) |
| `apps/api/src/composition.ts` | 修改 | `AppServices.familyRepository` 的类型收窄为**接口**(见第 5 节发现 2) |
| `apps/web/src/api/backend.smoke.ts` | 修改 | 新增 2 条真实后端断言(积分四数 + 防探测) |
| `docs/CONTRACTS.md` | 修改(共享) | #15 置"已实现",补授权矩阵与"四数只转发"的说明 |

## 3. 接口与数据变更

- **新增接口**:`GET /api/families/:fid/points/:uid` → `{earned, available, spent, frozen}`(形状此前已冻结,本轮未改)。
- **数据表变更:无。** 四个数字读自已有的 `Membership` 列;**没有新增流水表** —— `PointsTxn` 早就存在,
  它是审计流水,四个数字是缓存列,两者的一致性由 J7 对账任务负责(本轮不涉及)。
- **破坏性变更:无。**
- **是否更新 CONTRACTS.md:是**(#15 状态 +「积分查询交付说明」)。

### 授权矩阵(冻结)

| 调用者 | 结果 |
|---|---|
| 该家庭成员(任意角色) | 200 —— 成员之间积分**互相可见**,这正是产品的透明度设计 |
| 不是该家庭成员 | 403 `not_a_member` |
| 家庭不存在 / `:uid` 不是该家庭成员 | **同一个 403**,不区分(否则可探测 user id 是否存在) |
| 无 token | 401 `unauthorized` |

> **关键实现细节**:门禁校验的是**调用者**的成员资格。只校验"被查的人是否在家庭里"会让人猜到
> 一个 user id 就读到别人的数字 —— 这在代码里写成了注释,并有测试钉住。

## 4. 尚未完成 / 遗留 TODO

- [ ] **`#10` 证据上传未做**(`media-proof.upload`):本轮只完成了闭环的另一半。见第 5 节发现 4。
- [ ] `#11-#14`(模板 / 接取 / 评分 / 结算)仍未认领 —— **没有它们,四个数字永远都是 0**
- [ ] `family-user-directory-port`(B)、`auth-401-wording`(A)
- [ ] **CI 仍未推送**(等令牌 `workflow` 权限);本地提交已排队

## 5. 阻塞与风险(需要谁配合)

### ★ 发现 1(真 bug,已修):路由少写了 `/api` 前缀,端到端 404

**现象**:测试全绿、类型检查通过,但真实服务打这个 endpoint 返回 **404 Route not found**。

**定位过程**——**打印路由表**是唯一有效的一步:

```
├── /api/families      (POST, GET, HEAD)      ← 别人都在 /api 下
└── /families/:fid/points/:uid  (GET, HEAD)   ← 我挂在根上,少了 /api
```

**根因**:两条注册路径的前缀来源不同 ——
- family 路由经 `registerFamily()` 内部用 `app.register(..., { prefix: '/api' })`,所以写相对路径;
- 我的 `registerPoints()` **直接挂在根实例**上(和车道 A 的 auth 一样,因为它要用装饰在根上的
  `requireAuth`,而 Fastify 装饰器不会穿透 `register()` 的封装),所以路径必须写全。

**修法**:路径写成 `/api/families/:fid/points/:uid`,并在注释里写明这个差异。

**教训(值得复用)**:**"路由注册了"与"路由在契约要求的位置上"是两件事**。
类型检查和单元测试都发现不了它 —— 只有"打印路由表"或"真打一次"能发现。
本轮的冒烟测试正是发现它的那个环节(单测没抓到)。

### ★ 发现 2:`AppServices.familyRepository` 的类型该是接口而不是实现类

原先暴露的是 `InMemoryFamilyRepository`(具体类,带 `seedUser` 等测试辅助方法)。
给 points 路由传参时改成 `FamilyRepository`(接口):
- 路由只用到 `findMembership`,接口足够;
- 暴露具体类会**鼓励**别人去调只存在于开发环境的方法(如 `seedUser`、`snapshot`)。

### ★ 发现 3:我自己的测试数据违反了恒等式,被测试抓住了

`view.test.ts` 初稿里有几组数据不满足 `earned − spent === available`(如 `points=0.3, earned=0.1`)。
测试红了,我先去核对 `roundPoints` 的真实行为(`1.005` 因浮点舍入得到 `1`,不是 `1.01`),
确认**不是实现的问题**,然后重写用例:所有 fixture 必须满足恒等式,并加了一条
"守护 fixture 自身"的断言。

**为什么值得记**:这恰好说明"口径只有一份"这条规则的执行方式 ——
**测试数据也必须服从恒等式**,否则测试本身就在传播错误口径。

### 发现 4:闭环还差一半 —— 而且没有它,四个数字永远是 0

`#15` 只是**读**。真正的闭环是 `#10`(上传证据)→ `#12`(接取)→ `#13`(评分)→ `#14`(结算,写积分)
→ `#15`(读)。本轮完成后 **`#15` 可用了,但没有东西会往 `PointsTxn`/`Membership` 里写**,
所以新家庭的四个数字恒为 0(冒烟测试断言的正是这个行为)。

**建议下一步**:**`#10` 证据上传**(闭环里唯一有实际 IO 的一环,且 `media/expiry.ts` 的 72h 逻辑已就绪)。

### 风险:没有数据库,一切仍在内存里

仓库**没有 migrations、没有数据库文件**;`.env.example` 指向 SQLite。新增的接口在内存模式下工作,
重启即丢数据。这是项目既定的开发模式(冷克隆零配置),但**"能跑"与"能存"是两件事**,
正式演示前应先落一次 migrate。

## 6. 如何验证本轮改动

```bash
# 1) 本轮新增的单元测试
pnpm --filter @fcp/api test view          # 期望:7 passed

# 2) 真实后端冒烟(含积分四数 + 防探测两条新断言)
pnpm --filter @fcp/web test:smoke         # 期望:10 passed

# 3) 全量回归
pnpm -r typecheck && pnpm -r test         # 期望:3 包 Done;api 17 文件 233 用例;web 2 文件 13 用例

# 4) 想知道路由到底挂在哪(排查前缀类问题最快的办法)
#    在 apps/api 下跑一段 printRoutes() 的脚本,见第 7 节
```

**实测**:`view` 7/7;冒烟 **10/10**;`pnpm -r test` 退出码 0(api 233 / web 13);3 包 typecheck Done。

## 7. ★ 给下一个接手者的交接建议

**先读这三个文件**:

1. `apps/api/src/points/view.ts` —— **文件头写明"这里不许做算术"**。要加规则请去 `ledger.ts`;
   要"修正"存进来的数字?不要 —— 那会让 ledger 的 bug 变得不可见
2. `apps/api/src/routes/points.ts` —— 路径为什么要写全 `/api`,以及**门禁校验的是调用者**
3. `apps/web/src/api/backend.smoke.ts` —— 积分那两条断言钉住了"四数齐全 + 恒等式 + 防探测"

**排查路由问题的最快办法**(本轮就是靠它定位的):

```ts
// apps/api 下临时跑:pnpm exec tsx <文件>
import Fastify from 'fastify';
import { registerRoutes } from './src/routes/index.js';
const app = Fastify();
await registerRoutes(app, { secret: 'x' });
await app.ready();
console.log(app.printRoutes({ commonPrefix: false }));
```

**接着做最省事的顺序**:

1. **`#10` 证据上传**:`media/expiry.ts` 的纯逻辑已就绪(`computeExpireAt` / `decideDeletion` /
   `planCronPass`,15 个测试)。上传成功**必须立刻写死 `expireAt`**(D8 的硬要求),
   不要依赖后续扫描补写
2. `#12` 接取 → `#13` 评分 → `#14` 结算(结算要调 `scoring/settle.ts`,**不许另写一份**)
3. 四个数字一旦开始被写入,`#15` 才真正有意义

**别踩的坑**:

- **直接挂在根实例的路由,路径必须自带 `/api`**;经 `register(..., { prefix })` 的才用相对路径。
  写错的表现是**端到端 404,而单测全绿**。
- **测试 fixture 必须满足恒等式** `earned − spent === available`。不满足的话,测试自己就在传播错误口径。
- **`roundPoints` 的浮点行为不要"修"**:`roundPoints(1.005) === 1`。
  它与 `ledger.ts` 是同一份实现,单独改这一层会让两层口径不一致。

## 8. ★ 我在别人代码里发现的问题

**无新增。** 本轮读到的 family 模块代码(为接通 `findMembership`)依旧干净:
仓储接口按读写分离、`MembershipRecord` 把四个数字都放在一处。

**我自己的两条仍在**(不影响功能):`docs/CONTRACTS.md` 两节边界指引;`PENDING.json` 的 `note` 不应写快照数字。

## 8.5 ★ 本轮**未验证**的维度

**我排除的维度(排除 + 依据)**:

- **Prisma 落库路径**:依据 = 仓库没有数据库、没有 migrations,本轮目标是在内存模式下把接口跑通
- **并发写四个数字**:依据 = 本轮只读,没有任何写入路径;等 `#14` 结算落地后再测并发

**我根本没测的维度(没碰 + 漏了会怎样)**:

- **有真实数据时的表现**:四个数字目前恒为 0。漏了会怎样 = **四数的"非零"路径从未被任何测试走过**,
  而那正是最容易出错的地方(舍入、恒等式、冻结子集)
- **`:uid` 属于该家庭但调用者角色为 child 时的行为**:授权矩阵说"任意角色都可见",
  实现也如此,但**没有专门的测试**;漏了会怎样 = 若将来有人收紧权限,这条会静默失效
- **`PointsTxn` 与 `Membership` 的一致性(J7 对账)**:完全没碰。
  漏了会怎样 = 流水与缓存列漂移时无人发现,而这正是 F1 要求 J7 存在的原因
- **前端有没有真的显示这四个数字**:本轮只做后端。漏了会怎样 = 接口可用但用户看不到

## 9. 文档同步情况

- [x] `CONTRACTS.md`(#15 已实现 + 授权矩阵 + 交付说明)
- [x] `INDEX.md`(本行)
- [ ] `PENDING.json` —— **未加条目**:`#10` 及 #11-#14 属于"下一步要认领的工作",
      按机制应由认领者自行登记(或本轮末补录为 `task`)。**本轮先写在这里**
- [ ] `ROADMAP.md` —— 未改:等闭环(#10/#12/#13/#14)一起完成后统一更新更准确
