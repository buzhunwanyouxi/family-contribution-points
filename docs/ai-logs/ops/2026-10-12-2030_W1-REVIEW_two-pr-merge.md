---
task_id: W1-REVIEW
operator: 发起人(buzhunwanyouxi)
ai: DSH (DeepSeek Harness)
date: 2026-10-12 20:30
module: docs + 跨模块审查
branch: main
status: done
related_requirements: [第 14 章, A1-A8, D6-D9, F1-F8]
---

## 1. 本轮目标(一句话)

同时审查车道 A(PR #1)与车道 B(PR #2)的交付,**用实测确认两个 PR 能否一起合并**,
并据实测结果修订协作规则、登记两处契约缺口、清理危险分支。

## 2. 变更文件清单

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `docs/CONTRACTS.md` | 修改 | 新增 #10b `GET /api/families/:fid/invite`(待认领);新增「邀请码规范」小节(把车道 B 的默认值正式登记) |
| `docs/ROADMAP.md` | 修改 | W1-01~W1-06 补上真实负责人与精确状态(与 `OWNERS.md` 对齐) |
| `docs/GITHUB-TOKEN-SETUP.md` | 修改(上一提交) | 按官方文档更正:协作者必须用经典令牌,细粒度令牌不支持协作者场景 |
| `docs/DAY1-PLAN.md` | 修改(上一提交) | 禁令 9 更正;新增禁令 10(不许把令牌长期写进文件) |
| `docs/ai-logs/README.md` | 修改 | ops 日志模板新增**第 7 节「给下一个接手者的交接建议」**与**第 8 节「我在别人代码里发现的问题」**;纪律从 10 条扩到 12 条 |
| `docs/PROJECT_GUIDE.md` | 修改 | 14.5 节修订:新增「规则 0:先分片再并行」与子模块拆分标准;补记共享文件冲突的实测结论 |
| `docs/ai-logs/OWNERS.md` | 修改 | 新增「子模块拆分建议」表(可单独认领的粒度) |
| `docs/ai-logs/ops/2026-10-12-2030_W1-REVIEW_two-pr-merge.md` | 新增 | 本文件 |
| `docs/ai-logs/INDEX.md` | 修改 | 追加本行 |

**远端操作**:删除分支 `broken-api-push-do-not-merge`(见第 5 节)。

## 3. 接口与数据变更

- **新增契约登记**:#10b `GET /api/families/:fid/invite` → `{inviteCode, inviteExpireAt, qrPayload}`,
  状态 **待认领**(前端 P12 需要,当前无人实现、也无人认领)。
- **正式登记车道 B 的默认值**(原契约只写"带有效期",未写死数字):邀请码 6 位 /
  字符集 32 字符(剔除 `0/1/O/I`)/ 有效期 7 天(`FAMILY_INVITE_TTL_DAYS` 可覆盖)/
  不存在与格式非法同回 `404` / `join` 幂等回 `200` / 家庭名 1–20 码点。
- **破坏性变更**:无。

## 4. 尚未完成 / 遗留 TODO

- [ ] PR #1 与 PR #2 **都未合并**(本轮只做审查与预演,没动任何一个 PR)
- [ ] `W1-01` 的找回密码、`W1-02` 子女 PIN、`W1-03` 二维码、`W1-04` 加入审批、`W1-05` 共同管理员、`W1-06` 多家庭切换 —— 均在 `ROADMAP.md` 标为未完成
- [ ] `#10b` 邀请码展示接口待认领
- [ ] `media-proof.upload`、`points.prisma/routes` 仍未做

## 5. 阻塞与风险(需要谁配合)

### ★ 风险 1(本轮最重要的发现):两个 PR 各自"无冲突",但**一起合并会冲突**

**实测方法**(在本地临时分支上完整预演,不碰 `main`):

```bash
git merge origin/feat/auth-register      # 0 冲突
git merge origin/feat/family-create      # 4 个文件冲突
```

**冲突文件(全部是共享文件)**:

| 文件 | 为什么会撞 |
|---|---|
| `apps/api/src/routes/index.ts` | 两人各自注册自己的路由(且原文件末尾缺换行,放大了冲突) |
| `docs/CONTRACTS.md` | 两人各自登记自己的「交付说明」与状态 |
| `docs/ai-logs/INDEX.md` | 两人各自追加自己的日志行 |
| `docs/ai-logs/OWNERS.md` | 两人各自更新自己模块的状态 |

**关键认知(请写进每个人的常识)**:

> **GitHub 在 PR 页面对每个 PR **单独**评估"与 base 是否冲突",它不知道**另一个 PR 的存在**。
> 所以"两个 PR 都显示 No conflicts"**不等于**"两个 PR 可以任意顺序合并"。**

**建议的合并顺序**:先合一个 → 另一个作者 `git rebase origin/main` 解决这 4 个文件的冲突
(原则:**保留双方的行**,不要二选一)→ 推送 → 再合第二个。

**为什么这不是纪律问题**:两人都完全按冻结契约实现、都没越界改别人模块、都在各自 PR 里
如实登记了共享文件改动。冲突来自"并行"本身。所以本轮的处置不是批评,而是**改规则**:
把认领粒度从「模块」拆到「子模块」,并明确共享文件的合并顺序(见 PROJECT_GUIDE 14.5 规则 0/2 补充)。

### 风险 2:A 的分支已 rebase 完成,他**没有**把这事写进 ops 日志

PR #1 现在是 `ahead=1 / behind=0`,`CONTRACTS.md` 已包含车道 C 的错误体契约(说明 rebase 时正确保留了双方改动)。
但**他这一轮没有任何 ops 日志或 PR 评论说明"已 rebase 到哪个 sha"**。按纪律应当补一句 —— 已建议。

### ★ 风险 3:危险分支(已处理)

`broken-api-push-do-not-merge` 是我在初始化阶段一次 API 提交事故留下的分支,内容只有 **29 个文件**
(`main` 是 69),**误合并会删掉 40 个文件**。车道 B 主动提醒了这一点。
**已删除**(`DELETE /git/refs/heads/broken-api-push-do-not-merge` → 204),事故本身已由
`docs/RETROSPECTIVE-初期突发问题复盘.md` 承接,不需要靠分支保留证据。

## 6. 如何验证本轮改动

```bash
# 1) 分支已清理:应只剩 main + 两个功能分支
git ls-remote --heads origin

# 2) 预演两个 PR 的合并冲突(在临时分支上做,别在 main 上)
git fetch origin
git checkout -b _rehearsal main
git merge origin/feat/auth-register            # 期望:0 冲突
git merge origin/feat/family-create            # 期望:4 个文件冲突(见第 5 节)
git merge --abort && git checkout main && git branch -D _rehearsal

# 3) 契约里已登记邀请码规范与 #10b
grep -n "邀请码规范\|families/:fid/invite" docs/CONTRACTS.md
```

## 7. ★ 给下一个接手者的交接建议

**给要接 `W1-01` 剩余部分(找回密码)的人**:

1. 先读 `apps/api/src/auth/index.ts`(公开出口)、`middleware.ts`(当前请求上下文怎么取)、
   `routes/auth.ts`(HTTP 层怎么装到根实例)。
2. **不要另写一套认证**:`app.requireAuth` / `currentUserId` 已装在**根实例**上,直接用。
3. 找回密码需要的短信/邮件通道**尚不存在**(`notify` 模块为空)。建议先只做"生成重置令牌 + 落库",
   把发送通道留成注入端口 —— 否则你会把 `notify` 的活一起揽进来。
4. **别踩的坑**:改密码必须走 `password.ts` 的哈希函数,不要自己调 `crypto`;`AuthError` 的错误码
   要与既有 `{error, message}` 形状一致(前端按 `message ?? error` 渲染)。

**给要接 `W1-03 二维码` / `#10b` 的人**:

1. 先读 `apps/api/src/family/invite.ts`:码的生成、字符表、TTL 都在这里,**复用不要重写**。
2. `#10b` 的响应形状已冻结:`{inviteCode, inviteExpireAt, qrPayload}`。`qrPayload` 建议**只放邀请码本身**,
   二维码由前端画(PWA 里加一个纯前端库即可,不要在后端生成图片 —— 那会引入图片存储与清理问题)。
3. **别踩的坑**:`#10b` 必须校验调用者是该家庭的 owner/admin,否则任何成员都能把邀请码泄给外人。

**给要接 `media-proof.upload` 的人**:

1. 纯逻辑已就位:`apps/api/src/media/expiry.ts`(`computeExpireAt` / `decideDeletion` / `planCronPass`)。
2. **上传成功必须立刻写死 `expireAt`**,不要依赖后续扫描补写 —— 这是 D8 的硬要求。
3. **删除有一条前置条件**:该任务实例必须**已结算**;`planCronPass()` 已经把这件事分成了
   `toDelete` 与 `toSettleThenDelete` 两个队列,**不要自己再判断一次任务状态**。

## 8. ★ 我在别人代码里发现的问题

> 以下**只记录不代改**,请对应负责人(或其 AI)自行处理。所有结论都附了证据。

| 严重度 | 位置 / 对象 | 问题 | 建议 | 证据 |
|---|---|---|---|---|
| **高** | `docs/GITHUB-TOKEN-SETUP.md`(我的文档,车道 B 报的) | 文档教协作者"改 Resource owner"来用细粒度令牌 —— **该方案无效**,会卡住每一个新协作者 | 改为经典令牌勾 `repo` | [官方文档](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens-limitations)明确列 "outside or repository collaborator" 为不支持场景 |
| **中** | `apps/api/src/auth/types.ts`(车道 A) | 该文件**独占**了全项目的 fastify 模块增强(`app.auth` / `app.requireAuth` / `request.authUser`)。这是对的选择,但**没有在文件头写"此处独占、别处不要重复 declare"**;后来者很容易再 `declare module 'fastify'` 一次,`tsc` 会报重复声明或静默合并出奇怪类型 | 在文件头加一段醒目注释说明独占约定(他的 ops 日志写了,但代码里没写) | 读 `apps/api/src/auth/types.ts` 前 20 行 + `routes/index.ts` 的注册方式 |
| **中** | `docs/GITHUB-TOKEN-SETUP.md`(已处置) | 上一版给我的改进建议"把令牌放进临时文件"没有安全警示 —— 而车道 B 正是这么做的(`C:\Users\联想\dsh\.tmp\gh-token.txt`) | 已在文档第 5 节写入"不要长期落盘、临时调试用完立刻删" | 车道 B 的 report 自述 |
| **低** | `apps/api/src/family/invite.ts`(车道 B) | 字符表注释写 32、实际 31(车道 B 自己发现并已修) | 保留一条长度断言,别只改注释 | 他的 ops 日志附录 |
| **低** | `apps/api/src/family/repository.ts`(车道 B) | 内存仓储的创建路径用了 `new Date()` 而不是注入时钟,导致"时钟可注入"在创建路径上是假的(车道 B 自己发现并已修) | — | 他的 ops 日志附录 |
| **低** | `apps/api/src/routes/index.ts`(双方) | **文件末尾缺换行**,两人都在此文件尾部附近加行,会把 diff 放大成"末行重写" | 加一个换行;并约定此文件只做"注册",不做格式整理 | 两次 merge 预演都提示 `\ No newline at end of file` |

**没有发现的问题也要说**:车道 B 的 `family` 模块在错误码设计上有意做了防探测
(邀请码不存在与格式非法同回 404、非成员与家庭不存在同回 403),这点**做得比我写的契约更严谨**,
已登记进契约保留。车道 A 的接口形状与冻结契约**逐字段一致**,`account` 单字段解析也正确。

## 9. 文档同步情况

- [x] `CONTRACTS.md`(#10b + 邀请码规范)
- [x] `OWNERS.md`(子模块拆分表)
- [x] `ROADMAP.md`(W1-01~06 负责人与状态)
- [x] `PROJECT_GUIDE.md`(14.5 规则 0 与共享文件实测补充)
- [x] `docs/ai-logs/README.md`(模板新增第 7、8 节 + 纪律 11、12)
- [x] `INDEX.md`(本行)
