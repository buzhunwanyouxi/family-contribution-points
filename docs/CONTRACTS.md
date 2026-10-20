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
| 6 | POST | `/api/families` | `{name, timezone?}` | `{family, membership}` | **已定稿(已实现 201)** | 车道 C 代拟 / 车道 B 实现 | 2026-10-11 |
| 7 | POST | `/api/families/join` | `{inviteCode, nickname?}` | `{family, membership}` | **已定稿(已实现 200,幂等)** | 车道 C 代拟 / 车道 B 实现 | 2026-10-11 |
| 8 | GET | `/api/families` | header: Bearer | `{families:[FamilySummary]}` | **已定稿(已实现)** | 车道 C 代拟 / 车道 B 实现 | 2026-10-11 |
| 9 | GET | `/api/families/:fid/members` | header: Bearer | `{members:[MemberSummary]}` | **已定稿(已实现)** | 车道 C 代拟 / 车道 B 实现 | 2026-10-11 |
| 10 | POST | `/api/families/:fid/instances/:iid/proof` | multipart:`file` | `{media:ProofMedia}` | **已定稿(已实现)** | 发起人(2026-10-15 实现) | 2026-10-15 |
| 10b | GET | `/api/families/:fid/invite` | header: Bearer(须为 owner/admin) | `{inviteCode, inviteExpireAt, qrPayload}` | **已定稿(已实现)** | 发起人(2026-10-13 认领) | 2026-10-13 |
| 11 | POST | `/api/families/:fid/templates` | `{title, timeOfDay, repeatRule, maxPoints, description?, assignMode?, claimerScope?, mustBeClaimed?, remindBeforeMin?}` —— 须为 **owner** | `{template:TemplateSummary}` | **已定稿(已实现)** | 车道 A(2026-10-20 实现) | 2026-10-20 |
| 12 | POST | `/api/families/:fid/instances/:iid/claim` | — | `{instance}` | 待认领 | — | — |
| 13 | POST | `/api/families/:fid/instances/:iid/scores` | `{percent}` | `{score}` | 待认领 | — | — |
| 14 | POST | `/api/families/:fid/instances/:iid/settle` | `{force?:bool}` | `{percent, points, settledBy}` | 待认领 | — | — |
| 15 | GET | `/api/families/:fid/points/:uid` | header: Bearer(须为该家庭成员) | `{earned, available, spent, frozen}` | **已定稿(已实现)** | 发起人(2026-10-15 认领) | 2026-10-15 |
| 16 | GET | `/api/families/:fid/instances?date=YYYY-MM-DD` | header: Bearer(须为该家庭成员) | `{instances:[InstanceSummary]}` | **已定稿(已实现)** | 发起人(M1,2026-10-20) | 2026-10-20 |
| 17 | GET | `/api/families/:fid/instances/:iid` | header: Bearer(须为该家庭成员) | `{instance:InstanceDetail}` | **已定稿(已实现)** | 发起人(M1,2026-10-20) | 2026-10-20 |
| 18 | GET | `/api/families/:fid/templates?status=active/paused/archived/all` | header: Bearer(须为该家庭成员);`status` 缺省 = `active` | `{templates:[TemplateSummary]}` | **已定稿(已实现)** | 车道 A(M2) | 2026-10-20 |
| 19 | PATCH | `/api/families/:fid/templates/:tid` | `{status: active/paused}` —— 须为 **owner**;`archived` → 400 `invalid_status_transition` | `{template:TemplateSummary}` | **已定稿(已实现)** | 车道 A(M2 补充) | 2026-10-20 |

### 任务实例读接口交付说明(#16/#17,2026-10-20)

**为什么要有这两个**:`#10` 上传证据要挂到实例上、`#12` 抢单要选实例、`#13` 评分要看实例 ——
但它们之前**没有任何读接口**。前端"今日任务"页也没东西可读。

**出参形状(冻结)**:

```jsonc
// InstanceSummary(#16 列表里的每一项)
{
  "id": "…",
  "templateId": "…" | null,      // null = 临时任务
  "title": "洗碗",
  "date": "2026-10-20",          // 家庭时区下的自然日
  "maxPoints": 3,
  "status": "open",              // 见下面状态机
  "deadlineAt": "2026-10-20T13:00:00.000Z",
  "claimerId": "…" | null,
  "claimedAt": "…" | null,
  "autoAssigned": false,
  "finalPercent": null,
  "finalPoints": null
}

// InstanceDetail(#17)= Summary + 结算信息
{ ...Summary, "settledAt": "…"|null, "settledBy": "owner|others_avg|fallback_60"|null, "createdAt": "…" }
```

**状态机(唯一实现在 `apps/api/src/instances/service.ts`,任何路由不许自己改 `status`)**:

```
open ──claim──▶ claimed ──start──▶ doing ──submit──▶ pending_score ──settle──▶ done
  │                 │                                                             ▲
  │                 └─────────────────────────────────────────────────────────────┘ (兜底结算)
  └── 到点无人接 ──▶ (自动指派,仍为 claimed,autoAssigned=true)

pending_score ──reject──▶ rejected        (已结算的驳回,不可再改)
任意未结算状态 ──abandon──▶ abandoned     (任务作废,记一次未履约)
```

| 从 | 允许到 | 说明 |
|---|---|---|
| `open` | `claimed`, `abandoned` | `claimed` 由 #12 抢单触发 |
| `claimed` | `doing`, `open`, `abandoned` | 回 `open` = 15 分钟内无责退单(D2)或超时释放(D3) |
| `doing` | `pending_score`, `open`, `abandoned` | `open` = 未完成被释放(D3) |
| `pending_score` | `done`, `rejected` | 只能由 #14 结算触发 |
| `done` / `rejected` / `abandoned` | **无**(终态) | 任何再流转 → **409 `invalid_status_transition`** |

> ⚠️ **同一状态重复设置是幂等的,不算非法流转**(`doing → doing` 返回当前实例,不报错)。
> 这不是疏漏:并发下两次相同请求不应把其中一个变成 500。
> 真正的非法流转是"跳过中间态"(如 `open → done`),那必须 409。

**授权**:与 `/api/families/:fid/**` 一致 —— 调用者必须是该家庭成员;
非成员返回 **403 `not_a_member`**,未知家庭返回**同一个 403**(防探测,见 `#15` 的说明)。
`:iid` 不存在或属于别的家庭 → **404 `instance_not_found`**,两者不区分。

### 固定任务模板交付说明(#11 / #18 / #19,2026-10-20,车道 A = M2)

实现落点:`apps/api/src/template/`(`types` / `errors` / **`repeat`** / `repository` / `service` / `index`)
+ 路由 `apps/api/src/routes/templates.ts`;`routes/index.ts` **追加 1 行**挂载(共享文件,已在当轮 ops 日志声明)。

**`TemplateSummary`(冻结)**:

```jsonc
{
  "id": "…", "familyId": "…", "title": "洗碗",
  "description": "可选;缺省时整个字段**省略**(不是 null)",
  "timeOfDay": "14:00",
  "repeatRule": "daily | weekly:1,3,5 | monthly:1",
  "maxPoints": 3,
  "assignMode": "claim | rotate",
  "claimerScope": "all | children | specific",
  "mustBeClaimed": true,
  "remindBeforeMin": 30,
  "status": "active | paused | archived",
  "createdAt": "2026-10-20T12:00:00.000Z"
}
```

**规则落点(`PROJECT_GUIDE` 4.2)**:

| 规则 | 落点 | 判据 |
|---|---|---|
| B1 仅创始人可写 | `service.ts` `requireOwner()` | 非 owner → 403 `not_owner`;**且先于字段校验**(否则成员能用 400 探出必填项);非成员 → 403 `not_a_member` |
| B2 必须有 `maxPoints` 且 > 0 | `normalizeCreateTemplateInput()` | 缺失 / 0 / 负数 / NaN → 400 `validation_error` |
| B3 提醒默认 30 分钟 | 同上 | 缺省 30;`0` 合法(准点提醒);上限 1440 |
| B4 必须有人接取 | 同上 | 缺省 `true` |
| B5 接取模式 | 同上 | `claim` / `rotate`,缺省 `claim` |
| B6 接取范围 | 同上 | `all` / `children` / `specific`,缺省 `all` |
| B7 暂停 / 恢复,历史保留 | `setTemplateStatus()` | 暂停后默认列表不含它、`?status=all` 仍在;重复暂停幂等 |
| B8 节假日 / 寒暑假任务表 | **未实现** | schema 无对应字段;未做原因见本轮 ops 日志第 4 节 |

**`repeatRule` 语义(最容易写错的两处)**:`weekly:7` = **周日**(ISO:1=周一 … 7=周日);
`monthly:31` 在 2 月**不生成、也不报错**(不是"顺延到月末")。纯函数在 `template/repeat.ts`。

**错误码(前端按码分支,不要按文案)**:

| HTTP | `error` | 什么时候 |
|---|---|---|
| 400 | `validation_error` | 字段不合法(`details` 数组给出 `path`) |
| 400 | `invalid_repeat_rule` | `repeatRule` 读不懂 —— 独立码,便于前端直接重开选择器 |
| 400 | `invalid_status_transition` | 想改成 `archived` 等 M2 不允许的目标 |
| 403 | `not_a_member` | 不是该家庭成员;**与"家庭不存在"同码**,防探测 |
| 403 | `not_owner` | 是成员但不是创始人(B1) |
| 404 | `template_not_found` | id 不存在,**或属于别的家庭**(同码,防探测) |


### 证据上传与读取交付说明(#10 已实现,2026-10-15;读取补齐 2026-10-16)

实现落点:校验 `apps/api/src/media/classify.ts`(纯函数)+ 签名 `access.ts` + 用例 `upload.ts` +
路由 `apps/api/src/routes/media.ts` + 存储端口 `media/store.ts`。
测试:classify 16 + access 12 + 服务层 19 + 上传 HTTP 7 + **读取 HTTP 10**。

**两个端点**:

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/families/:fid/instances/:iid/proof` | 上传(multipart,字段名 `file`)→ 201 `{media}` |
| **GET** | **`/media/:familyId/:instanceId/:mediaId`** | **读取证据本体**。带 `?exp=&sig=` 走签名;不带则要 Bearer |

**`media` 的响应形状(冻结)**:

```jsonc
{
  "id": "…", "refType": "instance", "refId": "…", "uploaderId": "…",
  "type": "image", "sizeBytes": 12345,
  "url": "/media/<familyId>/<instanceId>/<mediaId>?exp=1792174104&sig=4a6c…",  // ★ 已带签名
  "access": { "exp": 1792174104, "sig": "4a6c…" },                              // ★ 同一份签名
  "expireAt": "2026-10-19T…Z", "createdAt": "2026-10-16T…Z"
}
```

> ### ⚠️ `url` 与 `access` 的关系(踩过一次,别再踩)
>
> **`url` 是"可以直接请求"的完整地址,已经带了签名;`access` 是同一份签名的单独副本。**
> **不要**把 `access` 拼到 `url` 后面 —— 那会得到
> `…?exp=A&sig=B?exp=A&sig=B`,第二个 `exp` 变成 `"B?exp=A"`,签名校验失败,
> **而 url 看起来完全正常**。
>
> `access` 的用途只有一个:**重新拉取证据列表时自己重建 query**,省得回头解析 url。
> 测试 `media-read.test.ts` 里有一条专门钉住这个区别。
>
> ### ⚠️ `url` 是**相对路径**,前端必须配上自己那份 API 基址
>
> 真实浏览器验证时踩到过:探针页跑在 `:3456`、API 在 `:3455`,直接 `<img src="/media/…">`
> 会让浏览器去**页面自己的 origin** 取,拿回一个 HTML 页,`<img>` 裂图且**状态码是 200**
> (所以不看 `content-type` 根本发现不了)。
> 前端要用 `API_BASE + media.url`,**不要**把相对 url 当绝对地址用。

**读取端点的授权(两条路,都是冻结行为)**:

| 请求 | 结果 |
|---|---|
| `?exp=&sig=` 有效 | 200(证明调用者拿到了服务端签发的链接) |
| 签名无效 / 跨文件复用 / 改过 `exp` | **404 `media_gone`** —— 不给探测者任何信息 |
| 无签名 + 有效 Bearer + 属于该家庭 | 200 |
| 无签名 + 有效 Bearer + **不属于该家庭** | 403 `forbidden` |
| 无签名 + 无 token | 401 `unauthorized` |
| 证据已过 72 小时 / 已被删除 / 从未存在 | **404 `media_gone`**(三者同一个答案) |
| `?download=1` | `Content-Disposition: attachment`,否则 `inline` |

> ⚠️ **为什么不用 Authorization 头**:`<img src>` 发不出自定义头。三个选择里选了**签名 URL** ——
> 把会话令牌放进 query 会泄漏到浏览器历史与服务器日志(用长期凭据换短期需求);
> 改用 cookie 则要引入本项目目前没有的 CSRF 考虑。签名**只对这一份证据有效**且**自带到期时间**。
> 签名覆盖 `mediaId + exp`,所以换文件、改到期时间都会失效;上限 **72 小时**(与 D8 证据寿命一致),
> 默认 **6 小时**。

> ⚠️ **72 小时是在读取时判定的**,不只靠删除任务。删除任务可能还没跑、或者挂了,
> 而"72 小时后不可查看"是规则本身 —— 判定点放在读取路径上才不会被跳过。

**错误码(前端按码分支,不要按文案)**:

| HTTP | `error` | 什么时候 | 前端该做什么 |
|---|---|---|---|
| 400 | `no_file` | 请求里没有文件部分 | 提示重新选择 |
| 400 | `validation_error` | 路径参数不合法 | 报 bug |
| 401 | `unauthorized` | 无 token | 清会话跳登录 |
| 403 | `not_a_member` | 上传者不是该家庭成员 | 提示无权限;**与"家庭不存在"同码**,防探测 |
| 403 | `forbidden` | 读取时登录了但不属于证据所在家庭 | 提示无权限 |
| 404 | `instance_not_found` | 实例不存在,**或属于别的家庭** | 提示任务已删除;同样不区分,防探测 |
| 404 | `media_gone` | 证据不存在 / 已删除 / **已过 72 小时** | 显示"证据已到期"占位卡(4.10) |
| 409 | `instance_already_settled` | 任务已结算(done/rejected/abandoned) | 提示找家长 |
| 413 | `media_too_large` | 图片 >300KB 或视频 >20MB | 压缩后重试 |
| 415 | `unsupported_media` | 字节不是已知图片/视频格式 | 提示支持的格式 |

**校验规则(D7)**:

| 项 | 规则 | 判定依据 |
|---|---|---|
| 类型 | JPG / PNG / WebP / HEIC;MP4 / MOV / WebM | **魔数(magic bytes)**,不看客户端声明的 `Content-Type` |
| 图片大小 | ≤ 300KB | 真实字节数 |
| 视频大小 | ≤ 20MB | 真实字节数 |
| 声明矛盾 | 声明 `image/*` 但字节是视频 → 415 | 抓前端传错字段这类 bug |
| **视频时长 ≤15 秒** | ⚠️ **未在服务端强制** | 需要容器解析器;列在 ops 日志的未验证维度里,由客户端保证 |

**`expireAt` 在上传时写死** = `createdAt + PROOF_TTL_HOURS`(默认 72h,D8 硬要求),
不是等 cron 补写 —— 删除任务以这一列为准。

> ⚠️ **存储目前是进程内的(开发默认)。** 仓库冷克隆要能零配置运行(ADR-004),所以默认用的是
> 内存存储;**进程重启后字节会丢,而元数据行还在**。生产必须换成对象存储适配器(实现
> `ProofMediaStore` 端口即可),这一步列在 ops 日志的下一步里,不是遗漏。
>
> ⚠️ **任务实例目前是占位实现**(`apps/api/src/media/instances.ts`):`TaskInstance` 的读写
> (#11-#14)尚未开工,而上传必须先回答"这个实例存在吗、属于谁、结算了吗"。
> 任务模块落地后请**删掉那个文件**,把任务模块自己的 reader 传给 `createMediaService` ——
> media 模块只认识端口,不需要改。

### 积分查询交付说明(#15 已实现,2026-10-15)

实现落点:用例 `apps/api/src/points/view.ts`(纯映射)+ 路由 `apps/api/src/routes/points.ts`,
测试 `apps/api/src/points/view.test.ts`(7 个)+ 真实后端冒烟 2 条。

**四个数字只转发、不计算。** 唯一口径实现在 `apps/api/src/points/ledger.ts`(F5/F6 v1.3),
本接口从 `Membership` 原样取出并改个名(`points` → `available`),**不做任何加减、取整或"修正"**。
恒等式在每次响应上都必须成立:

```
earned − spent === available        冻结中是 available 的保留子集,不叠加
```

**授权(冻结)**:

| 调用者 | 结果 |
|---|---|
| 该家庭成员(任意角色) | 200 —— 家里每个人的积分**互相可见**,这正是产品要的透明度 |
| 不是该家庭成员 | **403 `not_a_member`** |
| 家庭不存在 / `:uid` 不是该家庭成员 | **同一个 403**,不区分 —— 否则可用它探测某个 user id 是否存在 |
| 无 token | 401 `unauthorized` |

> ⚠️ **`:uid` 允许查别人**:成员之间互相可见是有意设计。
> 但**调用者自己必须是该家庭成员** —— 只校验"被查的人是否在家庭里"会让人猜到 user id 就读到别人的数字。


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

> ✅ **邀请码展示接口已实现(2026-10-13,上表 #10b)**:`GET /api/families/:fid/invite`。
> 实现落点 `apps/api/src/family/invite-view.ts`(用例)+ `routes/family.ts`(挂载),
> 测试 `apps/api/src/family/invite-view.test.ts`(6 个用例,含授权矩阵)。
>
> **为什么它曾经是阻塞项**:`POST /api/families` 返回的 `family` 是冻结的 `FamilySummary`,
> **不含 `inviteCode`**,而本接口是唯一读取途径 —— 在它实现之前,**创始人拿不到邀请码,任何人都无法加入家庭**。
>
> **授权行为(冻结)**:
>
> | 调用者 | 结果 |
> |---|---|
> | owner / admin | 200 + `{inviteCode, inviteExpireAt, qrPayload}` |
> | 家庭成员但角色是 member/child | **403 `role_not_allowed`** —— 特意**不用** `not_a_member`,因为"你不是这个家庭的成员"对家庭成员是假话,会让人以为家庭丢了 |
> | 不在该家庭,或该家庭不存在 | **统一 403 `not_a_member`**(与上面同码,保持防探测) |
> | 无 token | 401 `unauthorized` |
>
> `qrPayload` 形如 `https://family-points.app/join?code=<邀请码>`,前端据此生成二维码;
> 邀请码**已过期时仍返回**并附上过去的过期时间,由前端提示"这个码过期了",而不是抛错。

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

### family 模块交付说明(#6-#9 已实现,车道 B)

实现落点:`apps/api/src/family/**`(8 个源文件 + 3 个测试文件,76 个用例)+
`apps/api/src/routes/family.ts`。上表 #6-#9 的路径、入参、出参**逐字未改**,本轮**无破坏性变更**。

- **成功状态码**:`POST /api/families` → **201**;`POST /api/families/join` → **200**(幂等);
  `GET /api/families` 与 `GET /api/families/:fid/members` → 200。
- **邀请码、`join` 幂等、`nickname` 语义、家庭名长度、时区、跨家庭 403**:正式规范见上一节
  「邀请码规范」,此处**刻意不重复**。
- **错误响应**:按本文件「前端调用约定」第 4 条,失败一律**同时**给出 `{error, message}` 两个字段。
  本模块新增的机器码:`validation_error`(400)、`invalid_invite_code`(404)、`invite_expired`(400)、
  `not_a_member`(403)、`user_not_found`(404)——与 auth 既有码不冲突。
- **积分四个数字只转发、不计算**:`points / earnedPoints / spentPoints / frozenPoints` 直接取自
  `Membership`,本模块不做任何加减或取整;唯一口径实现仍是
  `apps/api/src/points/ledger.ts`(F5/F6 v1.3)。

**跨模块:车道 B 已完成对车道 A 的交接**

```ts
// apps/api/src/routes/index.ts —— 顺序:先建 family 服务,再装 auth,最后装 family 路由
const familyService = createFamilyService();
await registerAuth(app, { familyDirectory: createFamilyDirectory(familyService) });
await registerFamily(app, { service: familyService });
```

`createFamilyDirectory()`(`apps/api/src/family/directory.ts`)满足 `auth/types.ts` 声明的
`FamilyDirectoryPort`;**未接线时 `families` 恒为 `[]`**(契约规则 5),接线后 register / login / me
三处都会带上家庭列表。family 路由复用 `app.requireAuth` + `currentUserId(request)`,**不自建中间件**;
若 `app.requireAuth` 缺失(注册顺序写错),`registerFamily()` **直接抛错拒绝启动**,
而不是静默变成一个公开接口。

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
### 变更登记(谁在哪一轮动过上面这些文件)

| 日期 | 车道 / 模块 | 文件 | 变更 |
|---|---|---|---|
| 2026-10-10 | auth(车道 A,W1-01) | `apps/api/src/routes/index.ts`、本文件 | 注册 auth 路由(根实例);冻结 #3-#5;新增「auth 模块交付说明」 |
| 2026-10-11 | family(车道 B,W1-B) | `apps/api/src/routes/index.ts`、本文件 | 注册 family 路由;#6-#9 置为已实现;新增「family 模块交付说明」 |
| 2026-10-12 | family(车道 B,W1-B2) | `apps/api/src/routes/index.ts`、本文件 | rebase 到含 auth 的 `main`;改为按「auth 模块交付说明」的写法复用 `app.requireAuth` + `currentUserId`;在 `routes/index.ts` 完成 `familyDirectory` 交接 |
