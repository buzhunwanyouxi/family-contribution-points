# 推送脚本怎么选(推不上去时看这里)

> **背景**:这个项目的 `github.com:443` **时通时不通**(实测:连续 5 次 `git push` 全部
> `Recv failure: Connection was reset`,而同一个网络的 `api.github.com` 正常)。
> 于是产生了 4 个脚本。**它们不是重复造轮子,是分别对付 4 种不同的失败。**
>
> **先试最简单的**:`git push origin main`。通了就不用看下面。

---

## 决策表

| 症状 | 用哪个 | 为什么 |
|---|---|---|
| `git push` 正常 | **`git push`** | 别用脚本 |
| `github.com:443` 连不上,但 `api.github.com` 正常 | **`scripts/api-push.mjs`** | 走 REST API 建树+建提交+移 ref |
| 远端已经有内容相同的提交,但 **sha 不同**(API 推送造的),本地看起来"落后" | **`scripts/api_push_ranged.mjs`** | 能指定"推到哪个提交为止",按**树内容**判断而不是按 sha |
| 要推**单个**提交,且它接在一个**本地没有的**远端 sha 上 | **`scripts/api_push_one.mjs`** | 用 `git commit-tree` 基于 API 读到的 base 建提交,不依赖本地 ref |

---

## 为什么"sha 不同"是常态而不是异常

**API 推送会在服务端重新生成提交**,所以同一次工作可能出现两条 sha 链:

```
本地:  bf37490  feat(media): implement GET /media/<key> …
远端:  d314f4e  feat(media): implement GET /media/<key> …   ← 内容相同,tree 一致
```

两边的 **tree 完全相同**(可用 `git rev-parse <sha>^{tree}` 对比),只是提交对象不同。

> ⚠️ **所以"`git status` 说本地落后"不等于本地缺东西。**
> **先比 tree,再决定要不要 reset。** 直接 `git reset --hard origin/main` 会把本地那批
> 已经验证过、但还没推的提交扔掉 —— 本项目已经踩过一次(`dfe070f` 那回)。

**核对方法**(比 sha 可靠):

```bash
# 两边的 tree 是否一致
git rev-parse <本地sha>^{tree}
git rev-parse <远端sha>^{tree}

# 远端 tree 的完整内容(不依赖本地对象)
#   https://api.github.com/repos/OWNER/REPO/git/trees/<tree-sha>?recursive=1
#   与 git ls-tree -r <本地sha> 逐路径比对
```

`resume/confirm_sync.py` 与 `resume/check_remote_files.py` 就是干这个的(在仓库外的
`D:\deepseek harness work\resume\`,不在版本控制里)。

---

## 一条重要的边界:`workflow` 权限

**经典令牌只勾 `repo` 时,推不了 `.github/workflows/**`**:

```
! [remote rejected] main -> main (refusing to allow a Personal Access Token to
  create or update workflow `.github/workflows/ci.yml` without `workflow` scope)
```

**API 通道同样被挡**(建 blob 可以,建 tree 时 404)。没有绕路。

**但有一分钟的绕法**:用**网页界面**新建那个文件。
网页走的是浏览器会话,**不是令牌** —— 本项目就是这么把 `ci.yml` 弄上去的
(令牌至今仍只有 `repo` 权限)。

> **判据**:**"令牌缺权限"只挡住令牌,不挡住浏览器。**
> 下次遇到"令牌推不了某类文件"时,先想一下有没有网页路径。

---

## 别做的事

- ❌ **不要为了推文件而新建更多令牌**。令牌越多越难管,本项目已经因为令牌栽过跟头
  (一次是权限选不出来,一次是自动填充把 DeepSeek 密钥灌进了登录框)。
- ❌ **不要在分叉时用 `git push --force`**。远端那批提交是别人验证过的内容,
  强推等于把校验过的历史换成没校验的。
- ❌ **不要把 `--no-frozen-lockfile` 这类"绕过"当成解**。推不上去是通道问题,
  不是内容问题 —— 换内容只会让问题更难查。
