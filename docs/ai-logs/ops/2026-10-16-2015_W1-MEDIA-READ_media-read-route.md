---
task_id: W1-MEDIA-READ
operator: 发起人(buzhunwanyouxi)
ai: DSH (DeepSeek Harness)
date: 2026-10-16 20:15
module: media-proof(补齐 CONTRACTS #10 的读取半边)
branch: main
status: done
related_requirements: [D6, D7, D8, D9]
---

## 1. 本轮目标(一句话)

实现 `GET /media/:key`,把 `#10` 从"存得进去、读不出来"补成完整闭环 ——
让上传返回的 url **真能打开**,并且过期后一定打不开。

## 2. 变更文件清单

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `apps/api/src/media/access.ts` | **新增** | 签名访问令牌(纯函数,12 个用例) |
| `apps/api/src/media/access.test.ts` | **新增** | 含 4 条攻击面断言(跨文件复用 / 改 exp / 换密钥 / 长度不符) |
| `apps/api/src/media/upload.ts` | 修改 | 加 `readProof()`、签名注入、`viewOf()` 统一出口 |
| `apps/api/src/media/upload.test.ts` | 修改 | 冻结形状断言加上 `access` |
| `apps/api/src/media/errors.ts` | 修改 | 新增 `media_gone`(404)与 `forbidden`(403) |
| `apps/api/src/routes/media.ts` | 修改 | 新增 `GET /media/*`;条件式 preHandler(签名 or 会话) |
| `apps/api/src/routes/media-read.test.ts` | **新增** | 10 个用例(含往返、跨文件、改期、陌生人、过期) |
| `apps/api/src/composition.ts` | 修改 | 签名密钥贯通,`AppServices.mediaAccessSecret` |
| `apps/api/src/routes/index.ts` | 修改(共享) | 把密钥传给 `registerMedia` |
| `docs/CONTRACTS.md` | 修改(共享) | #10 交付说明补"上传与读取"两个端点 + 三个 ⚠️ |

## 3. 接口与数据变更

- **新增接口**:`GET /media/:familyId/:instanceId/:mediaId` → 图片/视频字节(非 JSON)。
- **响应形状变化**:`media` 多了一个 **`access: {exp, sig}`** 字段(前端需要它重建签名 query)。
  这是**对已冻结合同的追加**,已在 `CONTRACTS.md` 写明并加测试钉住。
- **数据表变更:无。**
- **破坏性变更:无**(`url` 从"不带签名"变为"带签名" —— 见第 5 节发现 1,这是修 bug 不是破坏)。

### 授权矩阵

| 请求 | 结果 |
|---|---|
| `?exp=&sig=` 有效 | 200 |
| 签名无效 / 跨文件复用 / 改过 `exp` | **404 `media_gone`** |
| 无签名 + 有效 Bearer + 属于该家庭 | 200 |
| 无签名 + 有效 Bearer + 不属于该家庭 | 403 `forbidden` |
| 无签名 + 无 token | 401 |
| 已过 72 小时 / 已删除 / 从未存在 | **404 `media_gone`**(三者同答案) |
| `?download=1` | `Content-Disposition: attachment`,否则 `inline` |

## 4. 尚未完成 / 遗留 TODO

- [ ] **持久化存储**:仍是内存,重启后字节消失而元数据行还在
- [ ] **到期删除调度器**:`expiry.ts` 的纯逻辑(15 个用例)仍无人调用。
      注意:本轮把 **72 小时的判定放进了读取路径**,所以"过期后看不到"**已经生效**,
      缺的是"过期后把字节真的删掉"(存储回收)
- [ ] 视频时长 ≤15 秒的服务端校验
- [ ] 任务模块 `#11`-`#14`

## 5. 阻塞与风险(需要谁配合)

### ★ 发现 1(真 bug,已修):上传返回的 `url` 自相矛盾,照文档用必坏

**症状**:响应里同时给了 `url` 和 `access`,而 `url` **已经带了签名**。
于是任何"把 access 拼到 url 后面"的客户端会得到:

```
/media/…/abc?exp=A&sig=B?exp=A&sig=B
                  ^^^^^^^^^^^^^ 第二个 exp 的值变成 "B?exp=A"
```

→ 签名校验失败,**而 url 看起来完全正常**,报错只有一句"证据已过期或不存在"。

**我自己的探针先踩了**,浏览器里表现为裂图(401)。
**为什么测试没抓到**:路由测试直接用 `media.url` 请求 —— 那是对的、能过;
坏的是"文档与响应形状互相矛盾"这件事,只有**照着文档操作的客户端**会踩。

**修法**:明确"`url` 可直接请求;`access` 只用于重建,不许拼"。
并在 `media-read.test.ts` 加一条测试**钉住这个区别**(拼第二次必须失败)。

**教训**:**同一个事实给出两种表达方式,就会有客户端按错的那种用。**
要么 `url` 带签名而**不给** `access`,要么 `url` 不带签名而**只给** `access`。
本轮选了前者(前端更省事),并把 `access` 降级为"重建用"。

### ★ 发现 2(真集成陷阱,已写进契约):`url` 是相对路径,前端必须配 API 基址

探针页跑在 `:3456`,API 在 `:3455`。直接 `<img src="/media/…">` 会让浏览器去
**页面自己的 origin** 取,于是拿回**一个 HTML 页** —— 而 `HTTP 状态是 200`。

**所以不看 `content-type` 根本发现不了**:状态码、字节数、渲染结果全都会"看起来像是成功了"。

**处置**:写进 `CONTRACTS.md`(前端必须用 `API_BASE + media.url`),并在真实浏览器验证里
显式走这条路。**这条对 PWA 尤其危险**:开发时 Vite 有 `/api` 代理,`/media` **没有**代理,
所以同一段代码在开发环境能跑、换端口就坏。

### 发现 3:为什么签名 URL 而不是别的方案(决策留档)

`<img src>` **发不出自定义请求头**,所以"要 Bearer"这条规则会让图片永远加载不出来。三个选择:

| 方案 | 为什么没选 |
|---|---|
| 会话令牌放进 query | 泄漏到浏览器历史与服务器日志 —— 用**长期凭据**换**短期需求** |
| 改用 cookie | 要引入本项目目前没有的 CSRF 考虑;Bearer 是全局约定 |
| **✅ 签名 URL(选了)** | 只对**这一份证据**有效、**自带到期时间**、换文件或改期都失效 |

上限锁 72 小时(与 D8 证据寿命一致),默认 6 小时。**签名覆盖 `mediaId + exp`**。

### 风险:签名密钥在开发模式有默认值

`'dev-only-media-access-secret-change-me'`,理由与 JWT 一样(冷克隆要能零配置跑)。
**生产必须设置**,否则任何人都能给自己签发任意证据的访问链接。

## 6. 如何验证本轮改动

```bash
# 1) 签名逻辑(含攻击面)
pnpm --filter @fcp/api test access        # 期望:12 passed

# 2) 读取路由(含往返:上传返回的 url 直接取回同一份字节)
pnpm --filter @fcp/api test media-read    # 期望:11 passed

# 3) 全部 media
pnpm --filter @fcp/api test media         # 期望:80 passed

# 4) 全量
pnpm -r typecheck && pnpm -r test
# 期望:api 22 文件 298 用例 / web 2 文件 13 用例
```

### ★ 真实浏览器验证(本轮做了,不是可选项)

路由测试能证明**字节和响应头**对,证明不了**浏览器能渲染**。所以起了一个一次性探针服务
(真 app + 一个种子任务实例,用完即删),在浏览器里跑完整往返:

```
1. 注册            -> 201
2. 建家            -> 201
3. 登记任务实例    -> 200
4. 上传真实 PNG    -> 201  type=image  size=1522
5. 用 url 直接取回 -> 200  content-type=image/png  cache-control=private, no-store
   字节数 1522 vs 上传 1522 → 完全相同
6. <img> onload    -> 渲染尺寸 120×80  ✅
```

**这一步抓到了发现 1 和发现 2** —— 两者都是单元测试与路由测试**结构上抓不到**的。

## 7. ★ 给下一个接手者的交接建议

**先读这三个文件**:

1. `apps/api/src/media/access.ts` —— 为什么用签名而不是 Bearer(cookie / query 的反面理由都写在文件头),
   以及 **72 小时是上限、不是默认**
2. `docs/CONTRACTS.md` 里"证据上传与读取交付说明"的两个 ⚠️ —— **拼 url 的坑**与**相对路径的坑**
3. `apps/api/src/routes/media-read.test.ts` —— 那条"url 必须可直接请求"的测试是防回归的关键

**接着做最省事的顺序**:

1. **前端接上这一对端点**(上传 + 显示):`API_BASE + media.url` 直接塞进 `<img src>`;
   拿到 404 `media_gone` 时按 4.10 显示"证据已于 X 月 X 日到期自动删除"占位卡
2. **持久化存储适配器**:实现 `ProofMediaStore` 三个方法即可
3. **到期删除调度器**:调 `expiry.ts` 的 `planCronPass()`;注意"先结算后删除"
4. 任务模块 `#11`-`#14`(完成后证据才挂在真任务上)

**别踩的坑**:

- **不要把 `access` 拼到 `url` 后面**(发现 1)。`url` 已经签好了。
- **相对 url 必须配 API 基址**(发现 2)。而且**失败时状态码是 200**,不看 `content-type` 查不出来。
- **不要用 `@fastify/multipart` 或任何 preHandler 去挡签名请求**:签名校验需要路由参数,
  所以 preHandler 必须"有 sig 就放行、没 sig 才走会话"。本轮就是这么做并附注释的。
- **`timingSafeEqual` 长度不同会抛异常**:必须先比长度(access.test.ts 有一条钉住)。

## 8. ★ 我在别人代码里发现的问题

**无新增。**

**一处值得记的正确设计**:`request.authUser` 由 `app.requireAuth` 这个 preHandler 写入。
我一开始想手写一个"读 Bearer 并校验"的助手,后来改成**条件式调用现成的 `requireAuth`** ——
这样 401 的响应体与全站一致,也不会漏掉任何一种失败情况。
**复用它而不是重写,是本轮少踩坑的主要原因。**

**我自己的两条仍在**:`docs/CONTRACTS.md` 两节边界指引;`PENDING.json` 的 `note` 不应写快照数字。

## 8.5 ★ 本轮**未验证**的维度

**我排除的维度(排除 + 依据)**:

- **视频证据的读取**:依据 = 同一段代码路径,只有 `content-type` 与扩展名不同;
  上传侧的视频用例已覆盖 classify,读取侧没有视频特例
- **大文件(≈20MB)的读取内存**:依据 = 同一 buffer 路径,未单独测量;见下方"根本没测"

**我根本没测的维度(没碰 + 漏了会怎样)**:

- **★ `Range` 请求(视频拖动进度条)**:完全没实现。漏了会怎样 =
  **浏览器上视频无法拖动进度**,而这是"看证据"的常见动作;
  路由会返回整个文件(200 而非 206),部分播放器会因此不播
- **★ 前端真的接上了没有**:本轮只做后端。漏了会怎样 = 接口可用但用户仍看不到证据
- **存储回收**:72 小时判定已生效(看不到),但**字节永远留在内存里**。
  漏了会怎样 = 存储只增不减,与 D8"不再占用存储"不符
- **签名的密钥轮换**:改了 `mediaAccessSecret` 会让所有已发链接立刻失效。
  漏了会怎样 = 轮换密钥时用户看到"证据已过期"而不是"链接失效",难以排查
- **并发读取同一个媒体**:没测。漏了会怎样 = 未知;内存存储的读是只读操作,预计安全,但没有证据
- **`content-disposition` 里的文件名注入**:`filename` 由服务端生成(UUID + 扩展名),
  不含用户输入,所以本轮认为是安全的 —— **但没有测试钉住这个前提**

## 9. 文档同步情况

- [x] `CONTRACTS.md`(两个端点 + 形状 + 授权矩阵 + 三个 ⚠️)
- [x] `INDEX.md`(本行)
- [x] `PENDING.json`(本轮开工前已登记 `media-has-no-read-route`,现在完成)
- [ ] `PROJECT_GUIDE.md` 4.10 —— 未改:等删除调度器落地后一并写(那时才有完整的生命周期实现)
- [ ] `ROADMAP.md` —— 未改
