# GitHub 令牌配置指南(协作者必读)

> **谁会用到这份文档**:在本仓库(`buzhunwanyouxi/family-contribution-points`)里开发、但**账号不是仓库所有者**的协作者。
>
> **症状**:你新建令牌时,在 "Only select repositories" 里**找不到这个仓库**;或者推代码时收到 `403` / `push=false`。
>
> 一句话结论:**令牌的 Resource owner 必须选 `buzhunwanyouxi`,不能选你自己。**

---

## 一、为什么会出这个问题

GitHub 有两类 Personal Access Token,规则完全不同:

| 类型 | 能访问哪些仓库 |
|---|---|
| **Fine-grained(细粒度)** | **只能访问"Resource owner 名下"的仓库**。你选自己当 resource owner,就永远看不到别人的仓库 |
| **Classic(经典)** | 能访问**你这个账号能访问的所有仓库**(包括别人邀请你协作的) |

所以细粒度令牌不是不能用,而是**Resource owner 选错了**。

---

## 二、推荐做法:细粒度令牌(更安全,只授权这一个仓库)

打开 https://github.com/settings/tokens?type=beta → **Generate new token**

| 字段 | 填什么 |
|---|---|
| **Token name** | `fcp-dev`(随便起,能认出用途即可) |
| **Expiration** | 30 days |
| **Resource owner** | ⚠️ **改成 `buzhunwanyouxi`**(默认是你自己,这里是关键) |
| **Repository access** | 选 **Only select repositories** → 勾选 **`family-contribution-points`** |
| **Permissions → Repository permissions** | **Contents: Read and write** ← 这个必须给,负责 push |
|  | **Pull requests: Read and write**(想开 PR 就给) |
|  | **Workflows: Read and write**(只有在要改 `.github/workflows/` 时才需要) |
|  | 其余全部保持 **No access** |

点 **Generate token**,复制那串 `github_pat_...`。

### 如果改了 Resource owner 还是选不到仓库

说明 GitHub 网页还在用缓存的协作者列表。按顺序试:

1. 刷新页面(或退出登录再登一次)
2. 打开 https://github.com/buzhunwanyouxi/family-contribution-points/invitations 确认邀请**已经接受**(显示 Accept 按钮就是还没接受)
3. 还不行就在仓库页面直接访问一次,带着权限重新回到令牌页面

> 维护者这边可以用 API 核对你的权限,正常应该看到:
> `GET /repos/buzhunwanyouxi/family-contribution-points/collaborators/<你的用户名>/permission` → `permission = write`

---

## 三、备选做法:经典令牌(能用,但权限更宽)

只有在细粒度令牌怎么都配不通时才用这个。

👉 https://github.com/settings/tokens/new?scopes=repo&description=fcp-dev

- 勾 **`repo`**(整个第一块)
- Expiration 选 **7 days** 或 **30 days**
- **不要选 No expiration**

⚠️ 经典令牌 `repo` 权限 = **你账号下所有仓库的读写权**,泄露后果比细粒度大得多。用完请及时删除。

---

## 四、另一条路:根本不用令牌(最安全)

如果你就在**自己电脑上**用浏览器操作 git,可以让 Git 凭据管理器记住你的登录:

```bash
# 首次推送会弹出浏览器让你登录一次,之后自动记住
git push origin feat/your-branch
```

前提:
1. 你已经**接受**了仓库邀请(否则登录了也没有 push 权限)
2. 本机 Git 装了 Git Credential Manager(Windows 版 Git for Windows 默认自带)

这条路**不产生任何长期凭据**,是个人开发者的首选。只有当你需要让**脚本 / AI 助手在无人值守下推送**时,才需要令牌。

---

## 五、拿到令牌后怎么用

```bash
# 方式 A:交互式登录(推荐,令牌不会留在命令历史里)
git push origin feat/your-branch
# 弹出提示时:Username 填你的 GitHub 用户名,Password 粘贴令牌

# 方式 B:临时用在单条命令里(令牌会出现在命令历史,注意环境)
git push https://<你的用户名>:<令牌>@github.com/buzhunwanyouxi/family-contribution-points.git feat/your-branch
```

API 调用(例如查 PR、发评论):

```bash
curl -H "Authorization: Bearer <令牌>" \
     -H "Accept: application/vnd.github+json" \
     https://api.github.com/repos/buzhunwanyouxi/family-contribution-points
```

---

## 六、安全红线(违反会出事)

1. **令牌等同密码**:不要贴进聊天群、Issue、PR、日志或代码注释
2. **不要写进文件**:`.env` 已被 `.gitignore` 忽略,但也不要往里放令牌;更不要写进 `.git/config`
3. **不要提交**:一旦提交,视为已泄露,**立刻去 https://github.com/settings/tokens 删掉重建**
4. **用完即删**:任务完成后删除令牌,下次要用再生一个
5. **怀疑泄露**:立刻删除令牌 → 检查仓库最近的提交与 PR → 通知维护者

> 本项目初始化阶段就踩过一次:令牌被误放进临时脚本,虽然立刻清理且未入库,但教训是 —— **凡是出现在对话、日志、命令历史里的令牌,都当作已泄露处理**。

---

## 七、快速自检清单

推代码前,按这个顺序确认:

- [ ] 我已经**接受**了仓库邀请(不是"待处理")
- [ ] 令牌的 **Resource owner 是 `buzhunwanyouxi`**(不是我自己)
- [ ] 令牌的 **Contents 权限是 Read and write**(细粒度)或勾了 `repo`(经典)
- [ ] 令牌**没有**写进任何文件、没有提交
- [ ] `git remote -v` 指向 `https://github.com/buzhunwanyouxi/family-contribution-points.git`
- [ ] 我在**自己的分支**上(`feat/<模块>-<简述>`),不是直接推 `main`

全部打勾还推不上去,请把**完整报错信息**贴给维护者 —— 不要只说"推不上去",报错里通常直接写了是权限问题还是分支保护问题。
