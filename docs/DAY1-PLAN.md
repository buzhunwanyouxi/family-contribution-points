# Day 1 分工与协作手册(3 人版)

> **本文件是第一天(以及后续每个"并行日")的操作手册。** 由发起人在第一天开工前写入仓库。
> 三个人的 AI 都应该在开工前读一遍本文件,读完再读 `AGENTS.md` 与 `docs/CONTRACTS.md`。
>
> **一句话原则:第一天不是比谁写得多,而是把三条并行车道的地基和接口钉死。**

---

## 0. 为什么第一天最容易翻车

三个人的 AI 最容易在第一天做这几件事,后果都很严重:

| 常见错误 | 后果 |
|---|---|
| 三个人都去"搭地基"(各自写一份用户表 / JWT 中间件 / 响应格式) | 三套互不兼容的实现,合并时全废 |
| 三个人都去改 `schema.prisma` / `packages/shared/src/types.ts` | 同一文件三路冲突,靠手工解冲突很容易丢代码 |
| 一个人做后端、一个人等后端、第三个人不知道干啥 | 第一天结束零产出,士气崩 |
| 各写各的,晚上才提交 | 冲突留到最后一起爆,谁也不敢合并 |
| 前端等后端接口做完才开始 | 前端永远在等,第三天才能联调 |

**本手册的所有安排,都是为了避免上面五件事。**

---

## 1. 人员代号(已按实际分工更正 2026-10-10)

| 代号 | 名字 | GitHub 登录名 | 第一天角色 |
|---|---|---|---|
| **A** | **Miao** | `sun-521-s` | 主攻 `auth` 模块(注册/登录/JWT)+ **首个 PR 范本** |
| **B** | **喵** | `MIAO98J` | 主攻 `family` 模块(建家/邀请码/成员) |
| **C** | 发起人 | `buzhunwanyouxi` | 主攻 `scoring` 后台作业 + `web-app` 前端骨架 |

> ⚠️ **分工变更说明(2026-10-10)**:最初计划是 A=`MIAO98J` / B=`sun-521-s`,**两人已线下对调**为
> **A=`sun-521-s` / B=`MIAO98J`**。本文件、`docs/ai-logs/OWNERS.md` 与仓库实际提交人都按**新分工**记录。
>
> **注意 GitHub 登录名与显示名不是一回事**,写代码、开 PR、看 `git log` 时以**登录名**为准:
> `MIAO98J` 的显示名是 `Tousnad-layer sonw`,`sun-521-s` 没有设置显示名。
>
> 分工可以再调整,但**调整后必须立刻改这份表格并提交**,不要只在群里说 —— 否则别人的 AI 读到的是过期分工,
> 就会出现两个人写同一块代码的情况(这正是本项目第 14 章要防的事故)。

**车道内容没有变化**(A 仍然是 auth、B 仍然是 family、C 仍然是 scoring + 前端),只是**人换了**。

---

## 2. 第一天时间表

| 时间 | 动作 | 产出 | 谁必须参与 |
|---|---|---|---|
| **09:00 - 09:30** | 三人同步会(可线上) | 确认分工、确认本文件 | 全员 |
| **09:30 - 10:00** | **接口冻结**:各自把自己模块的接口写进 `docs/CONTRACTS.md` | 三个模块的接口签名定稿 | 全员 |
| **10:00 - 12:00** | 各自实现**后端最小接口** | 每人 1-2 个接口能跑通 | 全员 |
| **12:00 - 13:00** | 午休 | — | — |
| **13:00 - 17:30** | 各自完成**一个纵向切片** + 前端骨架 | 能本地演示的最小闭环 | 全员 |
| **17:30 - 18:00** | **停止写代码**(硬性) | — | 全员 |
| **18:00 - 20:00** | 写 ops 日志 + report,提 PR | 3 个 PR | 全员 |
| **20:00 - 20:30** | 互相 review + 合并 | `main` 上有 3 个已合并 PR | 全员 |
| **20:30 - 21:00** | 15 分钟同步:今天卡在哪、明天干什么 | 更新 `OWNERS.md` 与 `ROADMAP.md` | 全员 |

**为什么 17:30 必须停手**:留出 2 小时写日志和提 PR。不留这段时间,第一天一定是"代码在各自电脑上,仓库里什么都没有"。

---

## 3. 三条并行车道

```
                  ┌─────────────────────────────────────────┐
   09:30 冻结接口  │  CONTRACTS.md 里三个模块的接口签名定稿    │
                  └─────────────────────────────────────────┘
                                    ↓
   ┌────────────────────┬────────────────────┬────────────────────┐
   │  车道 A            │  车道 B            │  车道 C            │
   │  auth              │  family            │  scoring 作业      │
   │  注册 / 登录 / JWT  │  建家庭 / 邀请码    │  W3-04 结算作业    │
   │  + 前端登录页       │  加入家庭 / 成员列表 │  + PWA 骨架/路由   │
   └────────────────────┴────────────────────┴────────────────────┘
        ↓ 互不碰同一文件         ↓                    ↓
   三个 PR 分别落在不同目录,合并时零冲突
```

### 车道 A —— `auth`(责任人 A = `sun-521-s`)

**目标**:今天能注册、能登录、能拿到 token、能用 token 访问一个受保护接口。

| 顺序 | 任务 | 落点 |
|---|---|---|
| 1 | 接口契约:`POST /api/auth/register`、`POST /api/auth/login`、`GET /api/me` | 写进 `docs/CONTRACTS.md` #3-#5 |
| 2 | `register`:手机号或邮箱 + 密码,bcrypt 哈希 | `apps/api/src/auth/register.ts` |
| 3 | `login`:校验密码,签发 JWT | `apps/api/src/auth/login.ts` |
| 4 | `requireAuth` 中间件:解 JWT、注入 `userId` | `apps/api/src/auth/middleware.ts` |
| 5 | `GET /api/me` 验证中间件可用 | `apps/api/src/routes/auth.ts` |
| 6 | 单测:注册重复邮箱、密码错误、token 过期 | `apps/api/src/auth/*.test.ts` |

**额外职责**:你的 PR 是**全项目第一个 PR**,会被当成范本。
所以请把 PR 描述、ops 日志、report 都写完整(按 `docs/ai-logs/README.md` 的模板),后面两个人照抄你的格式。

### 车道 B —— `family`(责任人 B = `MIAO98J`)

**目标**:今天能创建家庭、生成邀请码、别人能用邀请码加入、能看到成员列表。

| 顺序 | 任务 | 落点 |
|---|---|---|
| 1 | 接口契约:`POST /api/families`、`POST /api/families/join`、`GET /api/families/:fid/members` | `docs/CONTRACTS.md` #6-#8 |
| 2 | 创建家庭:写 `Family` + 把创建者写成 `Membership.role = owner` | `apps/api/src/family/create.ts` |
| 3 | 邀请码生成 + 有效期 | `apps/api/src/family/invite.ts` |
| 4 | 加入家庭:校验邀请码、写 `Membership.role = member` | `apps/api/src/family/join.ts` |
| 5 | 成员列表 | `apps/api/src/family/members.ts` |
| 6 | 单测:邀请码过期、重复加入、非法邀请码 | `apps/api/src/family/*.test.ts` |

**依赖说明**:受保护接口需要 A 的 `requireAuth`。**不要自己再写一份中间件**——
先用一个自己的 stub 函数签名占位(返回固定的测试 userId),等 A 合并后切换过去。切换动作写进你的 ops 日志。

### 车道 C —— `scoring` 后台作业 + PWA 骨架(责任人 C = `buzhunwanyouxi`)

**目标**:①把"证据 72 小时过期"和"结算兜底"这两条最容易出事故的规则落成**可测试的纯逻辑**;②把前端骨架搭起来,让登录页能调到 A 的接口。

| 顺序 | 任务 | 落点 |
|---|---|---|
| 1 | 证据过期判定纯函数:`isExpired(now, expireAt)`、`hoursLeft(now, expireAt)`、`shouldRemind(hoursLeft, [24,6])` | `apps/api/src/media/expiry.ts` |
| 2 | 删除前置条件纯函数:`canDeleteProof(instance)`(必须先结算) | `apps/api/src/media/expiry.ts` |
| 3 | 单元测试覆盖边界:刚好 72 小时、已过期、剩 24 小时整、剩 6 小时整 | `apps/api/src/media/expiry.test.ts` |
| 4 | 前端:路由 + 登录页 + 家庭页占位 | `apps/web/src/App.tsx`、`apps/web/src/pages/Login.tsx` |
| 5 | 前端:API 客户端,**按 `CONTRACTS.md` 的签名写死**,先返回 mock | `apps/web/src/api/client.ts` |

**为什么把这两块给同一个人**:证据删除必须"先结算后删除",跨 `media-proof` 与 `scoring` 两个模块。
分成两个人做,一定会各写一套状态判断(这个坑已经写在初始化 ops 日志的风险第 2 条)。

**前端为什么先写死签名**:不要等 A/B 的接口做完。按契约写客户端 + mock 数据,
等真接口上线,只改 `client.ts` 里的 `USE_MOCK = false`。

---

## 4. 接口冻结清单(09:30 - 10:00 必须产出的东西)

三个人各自把自己模块的行写进 `docs/CONTRACTS.md` 的 **API 契约**表,格式照抄已有的 #1/#2 行。

**冻结的含义**:10:00 之后**不再改签名**(路径、入参、出参)。
确需改动时:①先在群里说一声;②改 `CONTRACTS.md`;③在 ops 日志的"接口与数据变更"里标**破坏性变更**;④通知受影响的模块负责人。

**今天必须冻结的接口**(签名由各自负责人拟定,此处只列清单):

| 模块 | 接口 | 负责人 |
|---|---|---|
| auth | `POST /api/auth/register` | A |
| auth | `POST /api/auth/login` | A |
| auth | `GET /api/me` | A |
| family | `POST /api/families` | B |
| family | `POST /api/families/join` | B |
| family | `GET /api/families/:fid/members` | B |
| media | `POST /api/families/:fid/instances/:iid/proof`(今天可只定签名不实现) | C |

**统一约定**(不要各自发明):

- 认证:`Authorization: Bearer <jwt>`
- 错误体:`{ error: string, details?: unknown }`
- 所有 `/api/families/:fid/**` 必须校验调用者属于该家庭,否则 **403**
- 积分是 2 位小数,百分比是 0-100 整数

---

## 5. 文件归属表(谁碰哪些文件,第一天硬性执行)

| 文件 / 目录 | 谁能改 | 说明 |
|---|---|---|
| `apps/api/src/auth/**` | **只有 A(`sun-521-s`)** | 车道 A 独占 |
| `apps/api/src/family/**` | **只有 B(`MIAO98J`)** | 车道 B 独占 |
| `apps/api/src/media/**`、`apps/web/**` | **只有 C** | 车道 C 独占 |
| `apps/api/src/scoring/**` | **谁都不改** | 骨架已完成并有单测,今天不动 |
| `apps/api/prisma/schema.prisma` | **谁都不改** | 表结构今天够用(已含 User/Family/Membership 等 11 张表) |
| `packages/shared/src/types.ts`、`constants.ts` | **谁都不改** | 需要新类型时,写在自己模块目录里的局部类型,等第二天统一上收 |
| `apps/api/src/routes/index.ts` | **谁改谁在群里报备** | 都要注册路由,是最容易撞的文件;建议 10:00 冻结时一次性把三行都加好 |
| `docs/CONTRACTS.md` | 三人都改,但**只改自己模块的行** | 第 4 节的操作 |
| `docs/ai-logs/**` | 三人都写,**各自新建自己的文件** | 严禁改别人的 |

### 第 5 节的关键技巧:10:00 一次性把路由注册改完

`routes/index.ts` 是三个人都要碰的文件,冲突概率最高。**解决办法:在接口冻结阶段由一个人(A)一次性把三行注册代码都写进去**:

```ts
await app.register(healthRoutes);
await app.register(scoringRoutes, { prefix: '/api/scoring' });
await app.register(authRoutes, { prefix: '/api/auth' });        // A
await app.register(familyRoutes, { prefix: '/api/families' });  // B
await app.register(mediaRoutes, { prefix: '/api/media' });      // C
```

然后 A、B、C 各自新建 `routes/auth.ts`、`routes/family.ts`、`routes/media.ts`(或放在自己模块目录里导出),
**这个共享文件之后就没人再动了**。这一招能直接消掉第一天最大的一个冲突源。

---

## 6. 第一天不许做的事(硬性)

1. **不许新增依赖**。需要新包时在群里说,由一个人统一加。
2. **不许改 `schema.prisma`**(今天不需要新表)。
3. **不许动 `apps/api/src/scoring/settle.ts`** —— 那是全项目唯一一份结算实现,已冻结,改了会让前端预览和后端结算漂移。
4. **不许把数据库从 sqlite 切到 PostgreSQL**(那是部署阶段的事,见 ADR-004)。
5. **不许直接推 `main`**,一律分支 + PR。
6. **不许在 17:30 之后继续写功能代码**(要留给日志和 PR)。
7. **不许提交 `.env`、密钥、任何照片/视频文件**。
8. **不许把 token / API key 贴进聊天记录、日志或提交**(这一条是血泪教训,初始化时就踩过)。
9. **不许用"细粒度令牌 + 自己的 Resource owner"** —— 那样永远选不到本仓库。
   遇到 403 / `push=false` / 令牌里找不到本仓库,直接看 [`GITHUB-TOKEN-SETUP.md`](GITHUB-TOKEN-SETUP.md)。

---

## 7. 分支、提交与 PR 规范(第一天照抄)

```bash
# 开工前
git checkout main && git pull
git checkout -b feat/auth-register        # A
git checkout -b feat/family-create        # B
git checkout -b feat/media-expiry         # C

# 提交信息必须带需求编号(PROJECT_GUIDE 的编号)
git commit -m "feat(auth): register with phone/email (A1, A3)"
git commit -m "feat(family): create family and invite code (A2, A3)"
git commit -m "feat(media): proof expiry rules (D8, D9)"

# 推送后开 PR,描述里必须包含
#   - 模块名 + 需求编号
#   - ops 日志与 report 的路径
#   - 手工验证步骤
#   - 破坏性变更(没有就写"无")
```

**Review 规则(三人都是新手,用这张清单)**:

- [ ] ops 日志里说的文件数与 PR 实际改动是否一致(不一致就打回,这是训练纪律的关键)
- [ ] 有没有违反第 6 节的禁令
- [ ] 改了口径却没有同步 `CONTRACTS.md`?
- [ ] 单测是否覆盖了新逻辑

每个 PR **至少一名人类 review**;A 的第一个 PR 建议由发起人亲自 review,作为范本。

---

## 8. 当天完成标准(Definition of Done)

到 21:00 同步会时,如果下面每一条都打勾,第一天就算成功:

- [ ] `main` 上有 3 个新合并的 PR(A / B / C 各一个)
- [ ] `docs/CONTRACTS.md` 里 auth、family、media 三个模块的接口都已定稿(状态从"待认领"变成"已定稿")
- [ ] `pnpm -r typecheck` 全过
- [ ] `pnpm --filter @fcp/api test` 全过(原有 8 个 + 各自新增的)
- [ ] 三个人各留下 1 份 ops 日志 + 1 份 report
- [ ] `docs/ai-logs/OWNERS.md` 里三个模块状态更新
- [ ] `docs/ROADMAP.md` 里 W1 对应任务打上 🟡
- [ ] 三个人都说得清"另外两个人在做什么"(这条是协作是否真的成立的唯一检验标准)

---

## 9. 第二天预告(先不要做)

第二天才合并车道、做完整闭环:

- 前端把 mock 换成真接口(A 与 B 的接口均已合并且稳定)
- 车道 C 开始 `points` 模块(F1-F8,三个数字 + 恒等校验)
- 车道 A 转向 `task-template`(B1-B8,注意:**仅创始人可写**)
- 车道 B 转向 `assignment`(D1-D5,抢单与兜底指派)

---

## 10. 写在最后

这个项目真正难的不是技术,而是**三个人三台电脑三个 AI 不打架**。
第一天把接口和文件归属钉死,后面每天都能并行;第一天抢着写功能,第三周一定在解冲突。

遇到任何与 `docs/PROJECT_GUIDE.md` 冲突的判断,**以指导文档为准**;
指导文档本身有问题,**改文档,不要偷偷改代码**。
