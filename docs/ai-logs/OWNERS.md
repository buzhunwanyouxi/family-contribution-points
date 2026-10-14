# 模块认领表(开工前必看)

> **规则**:同一模块同一时间只能有一个负责人。
> 开工前先看这里 —— 目标模块状态是`进行中`且负责人不是你,就**不要动它**,换一个模块或先沟通。
> 认领与完成时都请更新本表。

状态只有三种:`空闲` / `进行中` / `已完成`(可被再次认领做迭代,但要先标 `进行中`)。

## 人员对照表(以 **GitHub 登录名** 为准)

| 代号 | 名字 | GitHub 登录名 | 车道 | 独占目录 |
|---|---|---|---|---|
| A | Miao | `sun-521-s` | auth | `apps/api/src/auth/**` |
| B | 喵 | `MIAO98J` | family | `apps/api/src/family/**` |
| C | 发起人 | `buzhunwanyouxi` | scoring 作业 + 前端 | `apps/api/src/media/**`、`apps/api/src/points/**`、`apps/web/**` |

> ⚠️ **2026-10-10 分工对调**:最初 A=`MIAO98J` / B=`sun-521-s`,两人线下对调为 **A=`sun-521-s` / B=`MIAO98J`**。
> 本表、`docs/DAY1-PLAN.md` 已按新分工更新。
>
> **注意显示名不等于登录名**:`MIAO98J` 的显示名是 `Tousnad-layer sonw`;看 `git log`、开 PR、发邀请时请认**登录名**。

| 模块 | 目录 | 状态 | 负责人(人类) | AI 工具 | 起始日期 | 关联需求 | 备注 |
|---|---|---|---|---|---|---|---|
| auth | `apps/api/src/auth` | **进行中** | Miao(`sun-521-s`) | DSH | 2026-10-10 | A1, A3, A8 | 车道 A。接口已由 C 冻结(CONTRACTS #3-#5);**注册 / 登录 / JWT / `GET /api/auth/me` 已实现并有 91 用例**(23 文件),待 PR review 合并;**A8 PIN 登录与"找回密码"未做**;交接点 `FamilyDirectoryPort`(见 CONTRACTS「auth 模块交付说明」) |
| family | `apps/api/src/family` | **进行中**(追加 `#10b`) | 发起人(buzhunwanyouxi) | DSH | 2026-10-13 | A2, A4, A5, A6, **#10b** | 车道 B 已交付 #6-#9(76 用例)。**本轮追加 #10b 邀请码展示**:只**新增** `invite-view.ts` 与 `family.getInvite`,**不修改** B 已交付的任何文件逻辑。B 复岗时请注意这一行 |
| task-template | `apps/api/src/template` | 空闲 | — | — | — | B1-B8 | **仅创始人可写** |
| task-temp | `apps/api/src/task` | 空闲 | — | — | — | C1-C5 | 临时任务、悬赏冻结 |
| assignment | `apps/api/src/assignment` | 空闲 | — | — | — | D1-D5 | 接取、退单、兜底指派 |
| **scoring** | `apps/api/src/scoring` | **已完成(骨架)** | 项目初始化 | DSH | 2026-10-10 | E1-E14 | 纯函数 `settle()` + 单测已就位,**任何人不得另写第二份结算实现** |
| **media-proof** | `apps/api/src/media` | **进行中** | 发起人(buzhunwanyouxi) | DSH | 2026-10-10 | **D6-D9** | 证据 72h 过期纯逻辑已开工;上传接口签名已冻结,实现待做 |
| points | `apps/api/src/points` | 空闲 | — | — | — | F1-F8 | 流水表 + 三数汇总 + 恒等校验 |
| wish | `apps/api/src/wish` | 空闲 | — | — | — | G1-G8 | 愿望、定价、众筹、兑现 |
| notify | `apps/api/src/notify` | 空闲 | — | — | — | H1-H8 | 微信模板消息 / 短信 / 红点 |
| report | `apps/api/src/report` | 空闲 | — | — | — | I1-I6 | 贡献占比、月度报告 |
| shared | `packages/shared` | 空闲 | — | — | — | — | **共享文件,改动前先在日志里声明** |
| web-app | `apps/web` | **进行中** | 发起人(buzhunwanyouxi) | DSH | 2026-10-10 | P01-P19 | 骨架 + API 客户端 + 登录/建家/首页 + **P12 邀请卡片与二维码(2026-10-13,已在真实后端点通)**。⚠️ **`test` 脚本仍是空壳,web 包零测试** —— 见 `PENDING.json` 的 `web-has-no-tests` |
| infra | 根目录 / `.github` | **进行中** | 发起人(buzhunwanyouxi) | DSH | 2026-10-13 | 第 10 章 | CI、部署、备案;**含跨模块装配**(`apps/api/src/composition.ts` —— 谁和谁共享状态由它决定,见 ops log `2026-10-13-2200_W1-WIRE`) |
| docs | `docs/` | 空闲 | — | — | — | — | 规则文档维护(改规则必须人类拍板) |

---

## 子模块拆分建议(2026-10-12 新增,依据一次真实冲突事故)

> **为什么要拆到这么细**:实测发现,两位协作者各自"按模块"认领、都守规矩,合并时仍在 4 个文件上冲突。
> 「模块」这个粒度太粗 —— **同一模块的不同层被两个人先后改到,一样会撞**。
> 认领时请填到**子模块**这一级,规则见 `docs/PROJECT_GUIDE.md` 14.5「规则 0」。

| 模块 | 可单独认领的子模块 |
|---|---|
| `auth` | `app`(路由装配与类型)· `service` · `password` · `jwt` · `middleware` · `repository`(内存) · `repository.prisma` · `errors` · `tests` |
| `family` | `app` · `service` · `invite` · `directory` · `repository` · `repository.prisma` · `errors` · `tests` |
| `media-proof` | `expiry`(纯逻辑,已完成)· `upload`(HTTP)· `storage` · `cron`(J4 过期清理 / J5 到期提醒)· `tests` |
| `points` | `ledger`(纯逻辑,已完成)· `prisma`(落库)· `routes` · `reconcile`(J7 对账)· `tests` |
| `web-app` | `client`(API 客户端)· `pages/*` · `components/*` · `router/session` · `styles` |

**判定标准**:一个子模块若文件数 > 5,或改动会同时跨两层(如既改 HTTP 又改数据库),就继续拆 ——
**拆到"一个人半天能做完"为止。**

---

## 认领模板(复制到对应行)

```markdown
| media-proof | `apps/api/src/media` | 进行中 | 李四 | Cursor | 2026-03-02 | D6-D9 | 计划 3/5 完成 |
```

## 当前并行建议(避免互相等待)

可以同时开工、互不冲突的组合示例:

- **A 线**:`auth` + `family`(W1 地基)
- **B 线**:`task-template` + `assignment`(W2 任务流转,**注意 B1 只有创始人可写**)
- **C 线**:`media-proof` + `points`(W3 核心闭环,建议由最熟悉规则的人做)
- **D 线**:`web-app` 页面骨架(可与后端并行,但接口以 `CONTRACTS.md` 为准)

⚠️ `packages/shared` 被所有人依赖:**先定契约,再各自实现**。
