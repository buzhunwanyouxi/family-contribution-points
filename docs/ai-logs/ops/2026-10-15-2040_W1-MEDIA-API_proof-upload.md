---
task_id: W1-MEDIA-API
operator: 发起人(buzhunwanyouxi)
ai: DSH (DeepSeek Harness)
date: 2026-10-15 20:40
module: media-proof(实现 CONTRACTS #10 证据上传)
branch: main
status: done
related_requirements: [D6, D7, D8, D9]
---

## 1. 本轮目标(一句话)

实现 `#10` —— `POST /api/families/:fid/instances/:iid/proof`:把照片/视频作为任务证据存下来,
**上传即写死 72 小时到期时间**(D8),并确保没有任何路径能让不合规的文件进到存储里。

## 2. 变更文件清单

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `apps/api/src/media/classify.ts` | **新增** | D7 校验(纯函数):**按魔数判类型**,不信客户端声明 |
| `apps/api/src/media/classify.test.ts` | **新增** | 16 个用例(含边界:刚好 300KB 不误杀、声明矛盾要拦) |
| `apps/api/src/media/store.ts` | **新增** | `ProofMediaStore` 端口 + 内存实现(生产换对象存储) |
| `apps/api/src/media/errors.ts` | **新增** | 8 个可执行错误码(前端按码分支,不按文案) |
| `apps/api/src/media/instances.ts` | **新增** | ⚠️ **占位**任务实例表,见第 5 节发现 1 |
| `apps/api/src/media/upload.ts` | **新增** | 上传用例 + 内存元数据仓储 |
| `apps/api/src/media/upload.test.ts` | **新增** | 19 个用例(固定时钟,72h 精确断言) |
| `apps/api/src/routes/media.ts` | **新增** | HTTP 层:multipart + 授权 + 错误翻译 |
| `apps/api/src/routes/media.test.ts` | **新增** | 7 个用例(**multipart 真跑**) |
| `apps/api/src/routes/index.ts` | 修改(共享) | 挂载 `registerMedia`;删掉上一轮留下的占位注释 |
| `apps/api/src/composition.ts` | 修改 | 组装 media 三件套并暴露 |
| `apps/api/package.json` + lock | 修改 | 新增 `@fastify/multipart` |
| `docs/CONTRACTS.md` | 修改(共享) | #10 置"已实现" + 交付说明(错误码表 / 校验规则 / 两个 ⚠️) |

## 3. 接口与数据变更

- **新增接口**:`POST /api/families/:fid/instances/:iid/proof`(multipart,字段名 `file`)。
  成功 **201** + `{media: ProofMedia}`;形状此前已冻结,本轮未改。
- **数据表变更:无。** 用的是既有的 `ProofMedia` 模型(`expireAt` / `status` / `deletedAt` 都在)。
- **破坏性变更:无。**
- **是否更新 CONTRACTS.md:是**(#10 状态 + 错误码表 + 校验规则 + 两个已知限制)。

### 错误码(前端应据此分支)

`no_file`(400)· `validation_error`(400)· `unauthorized`(401)· `not_a_member`(403,防探测)·
`instance_not_found`(404,防探测)· `instance_already_settled`(409)· `media_too_large`(413)·
`unsupported_media`(415)

### 校验规则(D7)

| 项 | 规则 | 判定依据 |
|---|---|---|
| 类型 | JPG / PNG / WebP / HEIC;MP4 / MOV / WebM | **魔数**,不看 `Content-Type` |
| 图片 | ≤ 300KB | 真实字节数 |
| 视频 | ≤ 20MB | 真实字节数 |
| 声明矛盾 | 声明 `image/*` 而字节是视频 → 415 | 抓"前端传错字段"这类 bug |
| **视频 ≤15 秒** | ⚠️ **未在服务端强制** | 见第 8.5 节 |

## 4. 尚未完成 / 遗留 TODO

- [ ] **持久化存储适配器**(当前为内存,重启即丢字节)
- [ ] **`GET /media/:key` 读取路由**:`url` 现在指向 `/media/<key>`,但**这个路由还不存在**,
      所以证据目前**存得进去、读不出来**。见第 5 节发现 3。
- [ ] **到期删除任务(D8/D9)**:`expiry.ts` 的纯逻辑已就绪(15 个测试),但**没有调度器调用它**
- [ ] **视频时长 ≤15 秒**的服务端校验
- [ ] 任务模块 `#11`-`#14`(没有它,证据没有真任务可挂)

## 5. 阻塞与风险(需要谁配合)

### ★ 发现 1:任务实例完全不存在,上传没有东西可挂

`TaskInstance` 在本仓库里**没有任何读写实现**(`#11`-`#14` 未认领);`media/instances.ts` 是因此新增的
**占位实现**,并在三个地方写明是占位(`文件头` / `composition.ts` / `CONTRACTS.md`):

- 它只实现 media 模块允许问的那一件事(`InstanceReader`);
- 它**不实现任何任务规则**(谁能接、何时截止、积分多少)—— 那些是 `#12`-`#14` 的职责,
  在这里复制一份就是第二个真相源,正是本项目一直在防的东西;
- 任务模块落地后:**删掉它**,把任务模块自己的 reader 传给 `createMediaService`,media 模块不用改。

**为什么这样做而不是等**:上传是闭环里唯一有真实 IO 的一环,先把它做成"可端到端验证",
后续接上真任务时只需要换一个适配器。**但必须说清:今天存进去的证据,挂的是占位任务。**

### ★ 发现 2(设计取舍):传输上限故意比产品上限大 1MB

`@fastify/multipart` 的读取上限设为 **21MB**,而产品上限是 **20MB**。
如果两者相等,一个 21MB 的视频会被**解析器**拒绝并抛出通用错误;现在它会被**我们自己的校验**拒绝,
返回"视频太大了(上限 20MB),请拍短一点"。

**这是一条容易写反的规则**:把两个上限设成一样看起来很"严谨",实际会让越界用户收到无用的报错。

### ★ 发现 3:证据存得进去,但**读不出来**(本轮有意留下的缺口)

响应里的 `url` 形如 `/media/<familyId>/<instanceId>/<mediaId>`,但**没有任何路由提供这个路径**。
也就是说:字节在存储里、元数据在表里、URL 也生成了,但**前端拿到 URL 会 404**。

**为什么没顺手做**:读取路由涉及另一个决策 —— 下载权限(4.10 写着"下载仅限家庭成员")、
`Content-Disposition`、以及**过期后必须 404 而不是返回缓存**。它值得单独一轮,而不是塞进上传这一轮。

**这条已写进 CONTRACTS 与第 8.5 节,不是遗漏。**

### 风险:被拒绝的上传不留痕迹(有意为之),但也意味着没有失败审计

`upload.test.ts` 里有一条断言"被拒绝时 blob 为 0、元数据行为 0"。这是对的(不留半个文件),
但副作用是**失败的上传只在日志里**。如果将来要统计"用户为什么传不上去",需要另加计数器。

## 6. 如何验证本轮改动

```bash
# 1) D7 校验(纯函数,无需服务)
pnpm --filter @fcp/api test classify      # 期望:16 passed

# 2) 上传用例(固定时钟,精确断言 72h)
pnpm --filter @fcp/api test upload        # 期望:19 passed

# 3) HTTP 层:multipart 真跑(含路径正确性)
pnpm --filter @fcp/api test media.test    # 期望:7 passed

# 4) 全量回归
pnpm -r typecheck && pnpm -r test
# 期望:3 包 Done;api 20 文件 275 用例;web 2 文件 13 用例

# 5) 路由到底挂在哪(排查前缀/未挂载最快的办法)
#    在 apps/api 下跑 printRoutes(),见 ops 日志第 7 节
```

**实测**:classify 16/16;upload 19/19;media.test 7/7;`pnpm -r test` 退出码 0(api **275** / web 13);
3 包 typecheck Done。路由表确认:

```
└── /api/families
    ├── /:fid/instances/:iid/proof (POST)     ← 本轮
    └── /:fid/points/:uid (GET, HEAD)         ← 上一轮
```

## 7. ★ 给下一个接手者的交接建议

**先读这五个文件,顺序有意义**:

1. `apps/api/src/media/classify.ts` —— **类型由字节决定,不由 `Content-Type` 决定**。
   改这里之前先想清楚:任何"信任客户端声明"的改动都会让伪装文件通过
2. `apps/api/src/media/upload.ts` —— 文件头列了三件必须保持的行为,尤其**结算后拒绝上传**的理由
   (D8/E14 只说了"删除不阻塞评分",反向是不对称的)
3. `apps/api/src/media/instances.ts` —— **占位,任务模块落地后删掉它**
4. `apps/api/src/routes/media.ts` —— 传输上限为什么比产品上限大 1MB(发现 2)
5. `apps/api/src/routes/media.test.ts` —— multipart 请求**手工拼 body** 的写法可以照抄

**接着做最省事的顺序**:

1. **`GET /media/:key` 读取路由**(发现 3):不做的话证据存了也看不见。要点:
   校验调用者属于该家庭 + 过期后必须 404 + `Content-Disposition` 只对内
2. **持久化存储适配器**:实现 `ProofMediaStore` 即可(file system 或对象存储),
   接口只有 `put/get/remove/count`
3. **到期删除调度器**:调 `expiry.ts` 的 `planCronPass()` / `decideDeletion()`,**先结算后删除**
4. `#12`-`#14`(接取 / 评分 / 结算)—— 完成后四个积分数字才会真正动起来

**别踩的坑**:

- **不要用 `Request.file()` 的结果去判断类型**,只能拿字节判断(见上)。
- **不要把 `TRANSPORT_LIMIT_BYTES` 改成等于 `MAX_VIDEO_BYTES`**,那会让越界用户收到解析器的通用报错。
- **`@fastify/multipart` 必须在能看见路由的那个实例上注册**。本轮放在 `registerMedia` 内部
  (而它跑在根封装上下文里);挪进 `app.register(..., { prefix })` 就会让路由看不见解析器。
- **被拒绝的上传必须留下零痕迹**。`store.put` 之前先做完全部校验,顺序反了会留下孤儿 blob。

## 8. ★ 我在别人代码里发现的问题

**无新增。** 本轮为接通上传读了 `family` 仓储与 `auth` 中间件,两者依旧干净。

**值得一提的一处"前一轮留下的线索"**:`routes/index.ts` 里原本有一段注释,预告了 `#10` 的路径与
挂载方式(`await app.register(mediaRoutes, { prefix: '/api' })`)。本轮**没有照它做** ——
`registerMedia` 必须直接挂在根实例上,因为 `@fastify/multipart` 与被复用的 `app.requireAuth`
都要在同一个封装上下文里。注释已更新为实际做法与原因。

**我自己的两条仍在**:`docs/CONTRACTS.md` 两节边界指引;`PENDING.json` 的 `note` 不应写会过期的快照数字。

## 8.5 ★ 本轮**未验证**的维度

**我排除的维度(排除 + 依据)**:

- **真实照片/视频**:依据 = AGENTS.md 禁令 6,禁止提交真实家庭媒体;测试用魔数构造的字节,
  D7 的规则(类型 + 大小)只看字节头与长度,覆盖等价
- **iOS HEIC 在浏览器里的实际行为**:依据 = 无法在本机复现 iOS 上传;classify 按 `ftyp` brand 识别
  `heic/mif1/msf1`,但**浏览器能否正确解码并渲染 HEIC 是另一件事**,与本轮无关

**我根本没测的维度(没碰 + 漏了会怎样)**:

- **★ 视频时长 ≤15 秒**:完全没实现,只由客户端保证。漏了会怎样 =
  **一个 3 分钟的视频(只要 ≤20MB)会被接受**,而 D7 明确限制 15 秒
- **★ 读取路径(`GET /media/:key`)**:不存在。漏了会怎样 = **证据上传成功但前端打开是 404**
- **到期删除**:`expiry.ts` 的纯逻辑有测试,但**没有调度器**,所以 72 小时后什么都不会发生。
  漏了会怎样 = 存储无限增长,而 D8 的"自动删除"完全没有执行者
- **并发上传同一实例**:两条请求同时上传。漏了会怎样 = 目前安全(id 是 UUID、Map 写入原子),
  但**没有测试钉住**这个结论
- **真实对象存储的适配器**:没有。漏了会怎样 = 重启后字节消失而元数据仍在,
  前端会看到指向空文件的 URL
- **大文件的内存占用**:21MB 上限下,单请求峰值内存约等于文件大小 ×2(bytes + Buffer 副本)。
  漏了会怎样 = 并发大文件上传时内存压力未被量化

## 9. 文档同步情况

- [x] `CONTRACTS.md`(#10 已实现 + 错误码表 + 校验规则 + 两个 ⚠️ 限制)
- [x] `INDEX.md`(本行)
- [ ] `PENDING.json` —— **未加条目**:剩余项(读取路由 / 持久化 / 调度器 / #11-#14)是"下一步的工作",
      按机制应由认领者登记。**本轮先写在这里**,下次开工按第 12 步补录
- [ ] `PROJECT_GUIDE.md` 4.10 —— 未改:等到期删除的调度器真正跑起来,再把实现细节写进正式章节
- [ ] `ROADMAP.md` —— 未改:等闭环(#12-#14)一起完成后统一更新
