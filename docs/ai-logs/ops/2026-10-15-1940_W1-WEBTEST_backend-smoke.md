---
task_id: W1-WEBTEST
operator: 发起人(buzhunwanyouxi)
ai: DSH (DeepSeek Harness)
date: 2026-10-15 19:40
module: web-app(补齐真实后端冒烟测试)
branch: main
status: done
related_requirements: [第 14 章]
---

## 1. 本轮目标(一句话)

给 web 包补上**唯一能抓住 10-13 那类 bug 的测试**:一个起真 API、走真 HTTP、验真鉴权的冒烟脚本
(收件箱条目 `web-has-no-tests` 的核心部分)。

## 2. 变更文件清单

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `apps/web/src/api/backend.smoke.ts` | **新增** | **真实后端冒烟**:自己拉起 API 进程,8 个用例走完整主链路 |
| `apps/web/src/api/config.test.ts` | **新增** | 不需要服务的极简自检(配置加载、角色标签、积分口径) |
| `apps/web/vitest.config.ts` | **新增** | 两类测试的边界 + `pool: 'forks'`(**见第 5 节发现 1**) |
| `apps/web/package.json` | 修改 | `test` 从 `echo` 空壳变为真跑;新增 `test:smoke` / `test:unit`;加 `vitest` 依赖 |
| `pnpm-lock.yaml` | 修改(共享) | 上述依赖 |
| `docs/coordination/PENDING.json` | 修改 | 移除 `web-has-no-tests`(核心已完成) |

## 3. 接口与数据变更

- **HTTP 接口:无变化。** 本轮只新增测试。
- **新增命令**:`pnpm --filter @fcp/web test`(全部)、`test:smoke`(只真实后端)、`test:unit`(只免服务)。
- **破坏性变更:无。**
- **是否更新 CONTRACTS.md:否。**

### 冒烟测试覆盖什么(8 个用例)

| 用例 | 防的是什么 |
|---|---|
| `/health` 活着 | 起服务的脚手架本身 |
| 注册返回 201 + token,且 `families` 为 `[]` | 契约规则 5(新账号无家庭不是错误) |
| **带 token 建家成功** | **10-13 那个 bug:token 没被存/没被带上 → 稳定 401** |
| 登录返回家庭列表 | auth × family 接线(曾经两套内存用户表,建家直接 500) |
| **完整邀请闭环**:创始人取码 → 另一人用码加入 → 成员数 2 | `#10b` 之后"加入家庭"这条路真的通 |
| 普通成员取码 → 403 `role_not_allowed`,且文案**不含**"不是这个家庭的成员" | 防止把两个错误码合并(会让真实成员以为家庭丢了) |
| 无 token → 401 且是 JSON | 前端据此清会话跳登录 |
| 重复注册 → 409 且带中文 `message` | 前端在屏幕上渲染的是 `message`,不是机器码 |

## 4. 尚未完成 / 遗留 TODO

- [ ] **组件层测试仍无**(jsdom / testing-library 未引入)。**这是有意留下的**:
      它性价比低于冒烟测试(见第 5 节发现 2),需要时单独立项。
- [ ] `family-user-directory-port`(车道 B)、`auth-401-wording`(车道 A)
- [ ] 仓库仍**没有 CI** —— 因此本轮新增的测试目前只在"人记得跑"时生效(见第 8.5 节)

## 5. 阻塞与风险(需要谁配合)

### ★ 发现 1(踩坑记录):vitest 在默认线程池下**静默卡死**,而且根因不在测试里

**现象**:`pnpm --filter @fcp/web test` 既不输出、也不失败、也不超时 —— 就是挂着,
并留下一个监听端口的 API 子进程。第一次跑就把我卡了十多分钟。

**隔离过程**(值得记,因为顺序是唯一有效的):

1. 先查进程与端口 → 发现 **API 其实起来了并在监听**,且 `/health` 手工能打通 ⇒ 排除"API 起不来";
2. 再写一条**不碰任何服务**的极简测试 → **同样卡死** ⇒ 排除"冒烟测试/网络";
3. 于是怀疑执行池 → 改成 `pool: 'forks'` + `fileParallelism: false`;
4. **直接调 `node_modules/.bin/vitest.cmd`**(绕开 `pnpm` 包装)→ **298ms 跑完**。

**结论**:默认的 worker 线程池在这台机器上起不来;单进程 fork 池可以。
**另一个副产品**:经 `pnpm` 包装调用时输出会被吞掉、看起来像"卡住" ——
所以排查这类问题时**要直接调可执行文件**,不要隔着包装层看。

**为什么这个坑值得写进日志**:一个"静默什么都不做"的测试运行器**比没有测试更糟** ——
它会让人以为"测试通过",实际上什么都没检查。这正是本项目一直在防的那类假信号。

### ★ 发现 2:为什么先做冒烟测试而不是组件测试

`web-has-no-tests` 这条待办原本把两件事混在一起("补测试基建" + "加冒烟脚本")。本轮**只做后者**,
并把它从待办里移除,理由:

- 10-13 的 token bug,组件测试**也抓不到**(它在 mock 下不存在 —— mock 不校验 token);
- 只有"起真后端跑一遍"能抓,而且它 10 秒内跑完(实测 1.1~2.7 秒);
- 组件测试需要 jsdom + testing-library,还会牵扯 vitest 版本,收益却更窄。

**组件测试是有价值的,但它不是这条待办的关键路径。** 剩下的部分等真有 UI 逻辑要锁时再做。

### 风险:新测试依赖"能起 API 进程"

冒烟测试会 `spawn` 一个 node 子进程。在**受限沙箱**或 CI 里若不允许 fork,
它会失败而不是静默通过(`waitForApi` 30 秒后抛错)—— 这个失败模式是对的,但要提前知道。

## 6. 如何验证本轮改动

```bash
# 1) 真实后端冒烟(核心;会自己拉起 API,约 2 秒)
pnpm --filter @fcp/web test:smoke
# 期望:8 passed

# 2) 免服务的极简自检
pnpm --filter @fcp/web test:unit
# 期望:3 passed

# 3) 全仓库回归
pnpm -r test && pnpm -r typecheck
# 期望:shared 0 文件 / api 16 文件 226 用例 / web 2 文件 11 用例;3 包 Done

# 4) 确认测试依赖没被误打进产物
pnpm --filter @fcp/web build
# 期望:首屏 gzip 与加测试前一致(53.95 kB)
```

**实测**:冒烟 8/8(942ms);单测 3/3;`pnpm -r test` 退出码 0;3 包 typecheck Done;
构建产物与加测试前**逐字节同级**(首屏 166.68 kB / gzip 53.95 kB)。

### 反向证据:这份冒烟测试真的能抓到那类 bug

写完测试**必须证明它会失败**,否则只是一个绿色的装饰。用一次性探针验证过
(探针已删除,结论记在此处):

| 请求 | 结果 |
|---|---|
| `POST /api/families` **不带** `Authorization` | **401** ← 与 10-13 bug 时前端发出的请求完全一致 |
| 同一个 token **带上** `Authorization` | **201** |

⇒ 401 的唯一原因就是"没带 token",而这正是冒烟测试断言的那件事。

## 7. ★ 给下一个接手者的交接建议

**先读这三个文件**:

1. `apps/web/vitest.config.ts` —— **为什么 `pool: 'forks'`**:默认线程池在本机静默卡死,
   删掉这行会让整个 web 测试变成"看起来在跑、实际什么都不做"
2. `apps/web/src/api/backend.smoke.ts` —— 文件头写了它存在的唯一理由;
   里面的客户端是**刻意独立复述** `api/client.ts` 的行为,**不要改成复用** ——
   复用后客户端一坏测试就跟着坏,就测不出"浏览器发出的请求长什么样"
3. `apps/web/src/api/config.test.ts` —— 不需要服务的那些断言,任何环境下都应通过

**接着做最省事的顺序**:

1. **CI**(`infra` 模块):本轮新增的测试目前只在人记得跑时生效。接 CI 时**注意**:
   `pool: 'forks'` 意味着需要允许 fork 子进程;冒烟测试还会起 API
2. `media-proof.upload` + `points.prisma`:打通"派任务 → 评分 → 积分"闭环
3. `family-user-directory-port`(B)、`auth-401-wording`(A)

**别踩的坑**:

- **`*.smoke.ts` 必须留在 `include` 里**。vitest 会把 `include` 与命令行过滤**取交集**,
  不在 include 里的文件**连按文件名指定都跑不了**(这个坑本轮踩过一次,报错是 `No test files found`)。
- **不要用 `pnpm` 包装来排查 vitest 卡住**:输出会被吞掉,看起来像卡死。直接调
  `node_modules/.bin/vitest.cmd`,或干脆 `node node_modules/vitest/vitest.mjs`。
- **spawn API 时不要用 `shell: true`**:Windows 上会触发 Node 的 DeprecationWarning
  (参数不转义)。直接 `node <tsx cli> src/server.ts`。

## 8. ★ 我在别人代码里发现的问题

**无新增。** 本轮只新增测试与配置,没有改动 `apps/api`。

**我自己的两条仍未处置**(不影响功能,但记在这里免得忘):
`docs/CONTRACTS.md` 两节边界指引;`PENDING.json` 的 `note` 不应写会随时间过期的快照数字。

## 8.5 ★ 本轮**未验证**的维度

**我排除的维度(排除 + 依据)**:

- **组件层测试**:依据 = 第 5 节发现 2 —— 它抓不到本轮要防的那类 bug,且需要额外依赖;
  等真有 UI 逻辑要锁时再立项
- **浏览器内的真实点击**:10-13 已用 browser 自动化点通过整条链路;
  依据 = 时间盒,本轮目标是"可重复的自动化",不是"再手工点一遍"

**我根本没测的维度(没碰 + 漏了会怎样)**:

- **CI 环境下的表现**:仓库无 CI,而冒烟测试需要 fork 子进程 + 监听端口。
  漏了会怎样 = 接 CI 那天可能发现它在 CI 里跑不起来,而**在此之前它是绿的**
- **并发/重复执行**:两个冒烟测试同时跑会各起一个 API(端口随机避开冲突),
  但没验证过;漏了会怎样 = 并行跑两次可能互相干扰,目前靠随机端口侥幸避开
- **生成物是否为最新**:与本轮无关,但仍是上轮记下的同一个未解缺口
- **API 进程泄漏**:`afterAll` 会 kill,但若测试进程被强杀,子进程可能残留。
  漏了会怎样 = 机器上留下监听端口的孤儿进程(本轮排查时**真实观察到过一次**)

## 9. 文档同步情况

- [x] `PENDING.json`(移除 `web-has-no-tests`)
- [x] `apps/web/package.json`(test 不再是空壳;三个脚本)
- [x] `INDEX.md`(本行)
- [ ] `docs/PROJECT_GUIDE.md` —— 未改:等 CI 接上后,把"两层测试(免服务 / 真实后端)"写进第 14 章更合适
- [ ] `ROADMAP.md` —— 未改:web-app 的测试属新增能力,不在 W1 任务列表里
