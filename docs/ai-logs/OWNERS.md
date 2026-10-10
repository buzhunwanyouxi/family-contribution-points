# 模块认领表(开工前必看)

> **规则**:同一模块同一时间只能有一个负责人。
> 开工前先看这里 —— 目标模块状态是`进行中`且负责人不是你,就**不要动它**,换一个模块或先沟通。
> 认领与完成时都请更新本表。

状态只有三种:`空闲` / `进行中` / `已完成`(可被再次认领做迭代,但要先标 `进行中`)。

| 模块 | 目录 | 状态 | 负责人(人类) | AI 工具 | 起始日期 | 关联需求 | 备注 |
|---|---|---|---|---|---|---|---|
| auth | `apps/api/src/auth` | 空闲 | — | — | — | A1, A3, A8 | 登录注册、PIN 登录 |
| family | `apps/api/src/family` | 空闲 | — | — | — | A2, A4-A7 | 家庭创建、邀请码、角色 |
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
| web-app | `apps/web` | **进行中** | 发起人(buzhunwanyouxi) | DSH | 2026-10-10 | P01-P19 | 前端骨架 + API 客户端 + 登录/建家/首页 |
| infra | 根目录 / `.github` | 空闲 | — | — | — | 第 10 章 | CI、部署、备案 |
| docs | `docs/` | 空闲 | — | — | — | — | 规则文档维护(改规则必须人类拍板) |

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
