# 工作报告:rebase 到含 auth 的 main + 完成跨车道交接(W1-B2)

- **操作者**:喵(`MIAO98J`) ｜ **AI 工具**:DSH (DeepSeek Harness) ｜ **日期**:2026-10-12
- **状态**:✅ 完成

## 这次做了什么(3 行以内)

把分支 rebase 到已经含 A 那套 auth 的 `main`,四个 family 接口现在**用 A 的中间件真正上了锁**。
顺手做完了上一轮欠的交接:登录 / 注册 / `/api/auth/me` 三个接口现在会**真的返回家庭列表**了
(以前恒为空数组)。另外把测试从"自己造假的登录"换成"真的走一遍注册拿 token"。

## 怎么验证(你能亲手点的地方)

```bash
pnpm -r typecheck              # 三包全 Done
pnpm --filter @fcp/api test    # 14 个文件、215 个用例全过(车道 A 的 136 + 本模块 79)
```

最容易看懂的验证是这三条 curl(**不需要任何桩,auth 已经在 main 上了**):

```bash
$env:JWT_SECRET='local-verification-secret'; $env:PORT='3000'
pnpm --filter @fcp/api exec tsx src/server.ts

curl -X POST localhost:3000/api/auth/register -H "content-type: application/json" \
     -d '{"account":"13800138000","password":"a-good-password","nickname":"爸爸"}'   # families: []
curl -X POST localhost:3000/api/families -H "authorization: Bearer <token>" \
     -H "content-type: application/json" -d '{"name":"我们家"}'                      # 201
curl -H "authorization: Bearer <token>" localhost:3000/api/auth/me                  # families 里有这个家了
```

第三条能返回家庭,就说明**两个模块之间的交接真的通了** —— 这是本轮最值钱的一行。

## 影响与风险(需要你知道的事)

1. **`routes/index.ts` 里注册顺序不能调换**:`registerAuth` 必须在 `registerFamily` 之前。
   顺序反了会**启动直接失败**(故意的)。因为 Fastify 把"undefined 的守卫"当成"没有守卫",
   那样四个 family 接口会变成完全公开 —— 宁可不启动,也不能默默漏数据。
2. **共享文件动了两个**:`routes/index.ts` 和 `docs/CONTRACTS.md`,都已在契约 §5 和
   「变更登记」表里登记。接下来做 #10b 或 media 的人会在同一个文件继续叠加。
3. **真数据库仍然没跑过**。全部测试跑在内存仓储上;Prisma 适配器依旧只是类型检查通过。
   接数据库的人必须先做一次真实读写。

## 两处我**没有**照协调者步骤做(请 review 时确认)

**一、`OWNERS.md` 不能整份用 `main` 版。**
步骤里写"你的 family 认领行已经在里面了" —— 只对了一半。`main` 上那一行确实是我们的,但状态还是
`进行中`、AI 工具是 `—`、备注还是"实现进行中"。整份取 `main` 会**悄无声息地丢掉本轮的状态更新**,
而那份自检清单里**没有任何一条能发现它**。所以我取 `main` 版、只替换 `family` 一行。

**二、我的「family 模块交付说明」删掉了与 `main`「邀请码规范」重复的内容。**
发起人已经在 2026-10-12 把我 report 里的默认值正式登记成「邀请码规范」了。再复述一遍就是
同一件事两个出处,将来必然改一处忘一处。我的小节只留:状态码、新增错误码、积分只转发、
跨模块交接,并显式指向那一节。

## 下一步建议

`family` 模块本体已经收口,建议按这个顺序:

1. **认领契约里的 #10b**(`GET /api/families/:fid/invite`,邀请码展示 + 二维码)—— 发起人已经登记进
   契约表,状态"待认领",**目前不在任何人的模块里**,而前端 P12 正等着它。
2. **接 Prisma**(auth + family 共用同一个 client),把内存仓储换掉。
3. `family` 剩余项:共同管理员 / 移除成员 / 创始人转移(A6/A7)、子女 PIN 登录(A8)。

## 需要你决策的事

1. **`ROADMAP.md` 和 `OWNERS.md` 还是对不上**(W1-03~W1-06 负责人列是 `—`),我只改了自己模块的行。
2. **`packages/shared` 上收时机**:`FamilySummary` / `MemberSummary` 现在有 auth / family / web
   三份声明,该什么时候统一、由谁统一,需要定个顺序。
