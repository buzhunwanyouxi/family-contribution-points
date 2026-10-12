# GitHub 令牌配置指南(协作者必读)

> **谁会用到这份文档**:在本仓库(`buzhunwanyouxi/family-contribution-points`)里开发、但**账号不是仓库所有者**的协作者。
>
> **症状**:你在 "Only select repositories" 里**找不到这个仓库**;或者推代码时收到 `403` / `push=false`。
>
> **一句话结论:请用"经典令牌"(Personal access token (classic)),勾 `repo`。细粒度令牌在你这种身份下无法推送 —— 详见第二节。**

---

## 一、先说结论(照这个做就行)

1. 打开 👉 https://github.com/settings/tokens/new?scopes=repo&description=fcp-dev
2. **Note** 随便填(如 `fcp-dev`),**Expiration** 选 **7 days** 或 **30 days**(不要选 No expiration)
3. 勾选 **`repo`**(整个第一块,一个勾就够)
4. 点最下面 **Generate token**,复制 `ghp_` 开头的那串
5. 推代码时:用户名填你的 GitHub 登录名,密码**粘贴这个令牌**

```bash
git push origin feat/你的分支
# Username: 你的登录名
# Password: <粘贴令牌>
```

> ⚠️ **必须先接受仓库邀请**,否则令牌再对也是 `push=false`:
> https://github.com/buzhunwanyouxi/family-contribution-points/invitations

---

## 二、为什么不能用细粒度令牌(重要)

GitHub 官方文档明确列出细粒度令牌**当前不支持**的场景,见
[Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens-limitations):

> - Using fine-grained personal access token to contribute to public repos where the user is not a member.
> - **Using fine-grained personal access token to contribute to repositories where the user is an outside or repository collaborator.**

翻译:**"以仓库协作者身份向该仓库提交"这个场景,细粒度令牌目前不支持。**
同一页还写着:`Only personal access tokens (classic) have write access for public repositories that are not owned by you`。

所以用细粒度令牌时你会遇到:

| 现象 | 说明 |
|---|---|
| 在 "Only select repositories" 里**选不到本仓库** | 因为你不是它的所有者 |
| 即使换了设置能生成令牌,**推送仍会被拒** | 官方限制不在"选不选得到",而在"协作者身份不支持" |

> **本仓库踩过这个坑**:第一版文档给的方案是"把 Resource owner 改成仓库所有者",这是**错的** ——
> 协作者照着做依然推不上来。经车道 B 指出并核对官方文档后,**本文件已改为推荐经典令牌**。
> 保留这段是为了让后来者不再重复试错;如果你在别处看到"改 Resource owner 就行"的说法,那是过时的。

### 那 Resource owner 到底是干什么的?

细粒度令牌**只能访问"所选 Resource owner 名下"的资源**。选自己,就只看得到你自己的仓库。
**这条规则解释了你为什么选不到本仓库,但它不是解法。**

---

## 三、另一条路:根本不用令牌(个人开发首选)

如果你就在**自己电脑上**用浏览器操作 git,可以让 Git 凭据管理器记住登录:

```bash
git push origin feat/your-branch
# 首次会弹出浏览器让你登录一次,之后自动记住
```

前提:
1. 你已经**接受**了仓库邀请(否则登录了也没有推送权限)
2. 本机装了 Git Credential Manager(Windows 版 Git for Windows 默认自带)

这条路**不产生任何长期凭据**,是个人开发者最省心的方式。
只有当你需要让**脚本 / AI 助手在无人值守下推送**时,才需要令牌。

---

## 四、令牌怎么用(两种方式)

```bash
# 方式 A:交互式(推荐,令牌不会留在命令历史里)
git push origin feat/your-branch

# 方式 B:临时写进单条命令(令牌会出现在命令历史,注意清理)
git push https://<你的登录名>:<令牌>@github.com/buzhunwanyouxi/family-contribution-points.git feat/your-branch
```

调 API 时:

```bash
curl -H "Authorization: Bearer <令牌>" \
     -H "Accept: application/vnd.github+json" \
     https://api.github.com/repos/buzhunwanyouxi/family-contribution-points
```

---

## 五、安全红线(违反会出事)

1. **令牌等同密码**:不要贴进聊天群、Issue、PR、日志或代码注释
2. **不要长期落盘**:不要写进 `.env`(虽然它被忽略),不要写进 `.git/config`
   - ⚠️ **特别注意**:不要用"把令牌写进某个临时文件、脚本再读它"的方式长期保存。
     临时调试可以,但**用完立刻删除**,并确认那个路径不在会被同步/共享的目录里
3. **不要提交**:一旦提交,视为已泄露,**立刻去 https://github.com/settings/tokens 删除重建**
4. **用完即删**:任务完成后删除令牌,下次要用再生一个
5. **怀疑泄露**:立刻删令牌 → 检查仓库最近的提交与 PR → 通知维护者

> 本项目初始化阶段就踩过:令牌曾被误放进临时脚本,**虽然立刻清理且未入库,但教训是 ——
> 凡是出现在对话、日志、命令历史、临时文件里的令牌,都当作已泄露处理。**

---

## 六、快速自检清单

推代码前,按顺序确认:

- [ ] 我已经**接受**了仓库邀请(不是"待处理")
- [ ] 我用的是**经典令牌**,并且**勾了 `repo`**
- [ ] 令牌**没有**写进任何文件、没有提交、没有留在命令历史
- [ ] `git remote -v` 指向 `https://github.com/buzhunwanyouxi/family-contribution-points.git`
- [ ] 我在**自己的分支**上(`feat/<模块>-<简述>`),不是直接推 `main`

全部打勾还推不上去,请把**完整报错信息**贴给维护者 —— 不要只说"推不上去",
报错里通常直接写了是权限问题还是分支保护问题。

---

## 七、常见问题

**Q:我打开令牌页面看不到 `repo` 这个选项?**
A:说明你进的是**细粒度令牌**页面(地址里带 `type=beta`)。请用第一节那个直链,或从
`Settings → Developer settings → Personal access tokens → Tokens (classic)` 进。

**Q:能不能只给我"这一个仓库"的更小权限?**
A:经典令牌粒度较粗(`repo` 覆盖该账号下所有仓库)。若你只想要单仓库权限,可以用
**部署密钥(Deploy key)**:它绑定单个仓库、可设只读或可写。需要维护者把你的公钥加到仓库设置里,
想用就在群里说一声。

**Q:推送时提示分支保护?**
A:`main` 不允许直接推 —— 请推自己的分支然后开 PR(见 `CONTRIBUTING.md`)。
