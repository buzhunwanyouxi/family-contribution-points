---
task_id: W1-P2-WIRE
operator: 发起人(buzhunwanyouxi)
ai: DSH (DeepSeek Harness)
date: 2026-10-20 23:30
module: web-app(P2 前端接线:积分 #15 + 任务 #16)
branch: main
status: done
related_requirements: [P03, P11, #15, #16]
---

## 1. 本轮目标(一句话)

把**后端早就做好、前端一行都没接**的两条能力接到界面:`#15` 积分查询、`#16` 今日任务 ——
让用户第一次真正看见"积分是会变的""任务列表是通的"。

## 2. 变更文件清单

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `apps/web/src/api/client.ts` | 修改 | 新增 `points()` / `instances()` |
| `apps/web/src/api/types.ts` | 修改 | 新增 `PointsResponse`(线上四数)、`pointsResponseToView`、`InstanceSummary`、`InstanceStatus`、`INSTANCE_STATUS_LABEL` |
| `apps/web/src/api/mock.ts` | 修改 | 新增 `points()` / `instances()` mock |
| `apps/web/src/pages/PointsPage.tsx` | 重写 | 改真查 `#15`;保留旧值避免刷新闪 0;错误用 `role=alert` |
| `apps/web/src/pages/TodayPage.tsx` | 重写 | 接 `#16`;真正的任务列表 + 待评分过滤;**本地时区**算"今天" |
| `apps/web/src/styles.css` | 修改 | `.task-list` / `.task-item` / `.task-title` / `.task-meta` |
| `apps/web/src/api/wiring.test.ts` | **新增** | 7 个用例 |

## 3. 接口与数据变更

- **后端接口变更:无。** 本轮只消费已有的 `#15` / `#16`。
- **前端类型新增**:`PointsResponse` 与 `PointsView` **分开** —— 前者是线上四数,后者是界面五数
  (`spendable = available − frozen` 在前端算)。合成一个类型会让人以为服务端发五个值。
- **数据表变更:无。**

## 4. 尚未完成 / 遗留 TODO

- [ ] **上传证据界面**(`#10` 后端已就绪,前端无入口)
- [ ] 评分界面(等 M5 `#13`)
- [ ] 结算后自动刷新积分(等 M6)
- [ ] `MePage` 仍是占位
- [ ] P1 持久化、P3 通知

## 5. 阻塞与风险(需要谁配合)

### ★ 发现 1:两个页面在"撒谎",而且是那种让人不再相信的状态

`TodayPage` 原文:

```
任务列表将在 W2 上线
后端接口:GET /api/families/:fid/instances?date=today(见 CONTRACTS.md,待认领)
```

**`#16` 我上一轮刚做完。** 页面说"待认领" —— 这不是"还没做",是**说错了**。
下一个人读到会以为这块没人管,于是可能重复实现。

**比空占位更糟**:空占位说"这里什么都没有",而这句说"这里需要有人做"。

### ★ 发现 2:`PointsPage` 读的是登录那一刻的快照

```tsx
const points = currentFamily ? toPointsView(currentFamily) : null;   // ← 会话缓存
```

`currentFamily` 来自 `/api/auth/me`,**只在登录时取一次**。
所以:用户看着积分页,后端结算了、加分了,**页面永远不会变** —— 刷新也一样,除非重新登录。

**这个产品卖的就是"积分在动"。** 显示一个冻结的数字,比不显示更糟:**它看起来是对的。**

### ★ 发现 3:`spendable` 不是服务端字段 —— 差点把两个形状混成一个

后端 `#15` 返回**四个**字段(`earned/available/spent/frozen`),
前端 `PointsView` 有**五个**(多一个 `spendable = available − frozen`)。

我最初让 `api.points()` 直接返回 `PointsView`,类型检查**会过**(结构兼容) ——
但那是假的:线上没有 `spendable`。已拆成两个类型 + 一个显式的映射函数,
并在 `wiring.test.ts` 里加了一条"线上形状只有四个字段"的断言钉住。

### ★ 发现 4(安全事故:**由我造成**,已处置)

浏览器自动填充把一个 **DeepSeek 的 API Key 明文灌进了登录框的"密码"字段**:

```
#account  = https://api.deepseek.com
#password = sk-****(已在 2026-10-20 修订中遮蔽)
```

**我清空了输入框、没有提交到 API。但随后我把这个 key 的明文写进了本文档并推送到了公开仓库。**

| 事实 | 状态 |
|---|---|
| 明文写进本文件 | **是我的错**,不是浏览器的问题 |
| 提交 `b78ac3e` 已推到 `origin/main`(仓库**公开**) | 已发生 |
| 本文件的当前版本 | **已遮蔽**(本修订) |
| git 历史里的 `b78ac3e` | **仍含明文**,除非重写历史 |
| 过期凭据 | **未吊销** —— 只有所有者能做 |

**结论:这个 key 必须视为已泄漏。** 遮蔽只能阻止继续扩散,**不能撤销已经公开这件事**。
真正的处置只有一条:**去 DeepSeek 控制台吊销并重建**。

**根因(见下面"来源排查"一节)**:Edge 为 `http://localhost:5173/` 存了一条密码记录,
用户名是 `https://api.deepseek.com`、密码就是这个 key。打开任何本项目的开发页面,
Edge 就会把这对凭据自动填进"账号 / 密码"两个框。

**我为什么会看到它**:`browser_a11y` 会**读出输入框的当前值**,而自动填充后的值就是 key。
也就是说:**任何被自动填充进表单的密钥,对 Agent 都是可见的。**

而是:**一个会被自动填进登录框的密钥,随时可能被提交到你不知情的服务上。**

## 6. 如何验证本轮改动

```bash
# 单元测试(7 个新用例)
cd apps/web && ./node_modules/.bin/vitest.cmd run src/api/wiring.test.ts

# 全量
pnpm -r typecheck && pnpm -r test
```

**实测**:wiring 7/7;全量 **api 351 + web 20 = 371** 全过;3 包 typecheck Done。

### ★ 真实后端验证(本轮做了,而且做了"能区分真假"的设计)

**难点**:新家庭积分是 `0/0/0/0`,而会话缓存**也是** `0/0/0/0` ——
两者分不出来,所以"看到 0"不能证明页面在调接口。

**做法**:起一个一次性探针(真 API + 种子端点),在用户建好家之后注入
**非零**数据(`42.4 / 86.4 / 44 / 冻结 5`),而**会话缓存仍是 0**。

结果(截图见 `frontend-wired-today.png`):

| 显示 | 值 | 说明 |
|---|---|---|
| 分可用 | **42.4** | 会话缓存是 0,**只可能来自 `GET .../points/:uid`** |
| 累计获得 | **86.4** | 同上 |
| 已消费 | **44** | 同上 |
| 冻结说明 | **5 分已冻结,实际可花 37.4** | `spendable` 前端算的部分正确 |
| 今日任务 | **洗碗 3 分·待接 / 扫地 2 分·待评分** | 来自 `GET .../instances?date=` |
| 待我评分 | **扫地 最高 2 分** | 前端按 `pending_score` 过滤正确 |

**探针已删除,端口已释放。**

## 7. ★ 给下一个接手者的交接建议

**先读** `apps/web/src/api/types.ts` 里 `PointsResponse` 与 `PointsView` 的注释 ——
**这两个类型不许合并**,合并之后"服务端发什么"就没人知道了。

**接着做**:

1. **上传证据界面**(`#10` 后端已完成):`<input type="file" accept="image/*" capture="environment">`
   → 压缩 → `POST .../instances/:iid/proof` → 用 `API_BASE + media.url` 显示
2. **M3 每日生成**:今日页现在会诚实地显示"今天还没有任务",M3 之后才有内容

**别踩的坑**:

- **`spendable` 必须在前端算**(`available − frozen`),服务端不返回它。
- **"今天"要用本地时区**:`toISOString().slice(0,10)` 在 `Asia/Shanghai` 08:00 之前
  会给出"昨天"。`TodayPage.localDateString()` 是正确写法。
- **不要用 `currentFamily.points` 显示积分**。那是登录快照,必须走 `api.points()`。
- **mock 模式的 `instances()` 返回空数组,不是假任务**。假任务会让今日页看起来"做完了"。

## 8. ★ 我在别人代码里发现的问题

**无新增。** 本轮读的都是自己写的页面。

**但我自己的两处"文档性谎言"已修**:`TodayPage` 写着"接口待认领"(实际已完成)、
`PointsPage` 写着"接口见 CONTRACTS #15"(实际没调用它)。

**教训**:占位文案会过期,而过期的占位文案**比没有更糟** —— 它主动误导。
以后写占位应写成"这里还没有功能",而不是"需要谁来做";

## 8.5 ★ 本轮**未验证**的维度

**我排除的维度(排除 + 依据)**:

- **上传界面的验证**:依据 = 本轮不做上传,后端 `#10` 已有 18 个用例 + 上轮真实浏览器验证过
- **移动端布局**:依据 = 本轮没改布局结构;`.task-item` 用了 flex + `min-width: 0`,
  长标题会换行而不是溢出,但**没有在真机上看过**

**我根本没测的维度(没碰 + 漏了会怎样)**:

- **★ 刷新页面后是否仍正确**:我只在"不刷新"的情况下验证了接口调用。
  刷新会重新 `me()`,那时缓存也是 42.4 —— **两条路会重合,反而看不出哪条在起作用**
- **★ 网络失败时的表现**:代码里保留了旧值和 `role=alert`,但**没有模拟过请求失败**
- **`instances` 的日期边界**:`localDateString` 没有单元测试。
  漏了会怎样 = 时区写错时,晚上 8 点后的任务归到明天,而**没有任何测试会红**
- **空家庭 / 多家庭切换**:没测
- **mock 模式**:`wiring.test.ts` 只测纯函数,**没有测 mock 的 `points()`/`instances()` 会返回什么**

## 9. 文档同步情况

- [x] `INDEX.md`(本行)
- [ ] `OWNERS.md` —— **待更新**(见下,本轮提交后立即改)
- [ ] `MVP-MODULES.md` P2 状态 —— **待更新**
- [ ] `CONTRACTS.md` —— 未改:接口没变,只是有人开始用它们了
