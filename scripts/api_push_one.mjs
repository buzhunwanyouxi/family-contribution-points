/**
 * Commit and push .github/workflows/ci.yml as a single new commit on top of the remote main.
 *
 * Handles the case the previous scripts do not: the local branch and the remote have diverged in
 * sha (the API push recreated commits server-side), so the new commit is built with
 * `git commit-tree` against a base read straight from the API instead of the local ref.
 *
 * Safety rules preserved from scripts/api-push.mjs:
 *   1. base_tree = the remote head's tree -> unchanged files inherited, never a flat tree
 *   2. verify every blob we create against the local object's content hash before moving the ref
 *   3. blob bytes come from the git object DB, never the working tree
 *   4. refuse to start if the remote moved between read and write
 *   5. fast-forward only (force: false)
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPO ?? 'buzhunwanyouxi/family-contribution-points';
const BRANCH = process.env.GITHUB_BRANCH ?? 'main';
const PATH_TO_ADD = process.env.ADD_PATH ?? '.github/workflows/ci.yml';
const MESSAGE = process.env.COMMIT_MESSAGE ?? '';

const API = `https://api.github.com/repos/${REPO}`;
if (!TOKEN) { console.error('缺少 GITHUB_TOKEN'); process.exit(2); }

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'fcp-api-push-one',
  'Content-Type': 'application/json; charset=utf-8',
};

async function api(path, method = 'GET', payload) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const res = await fetch(API + path, {
        method, headers: HEADERS,
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      const text = await res.text();
      const parsed = text.trim() ? JSON.parse(text) : null;
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      return parsed;
    } catch (e) {
      if (attempt === 5) throw e;
      const wait = 3 * attempt;
      console.error(`    (第 ${attempt} 次失败: ${String(e).slice(0, 90)}，等 ${wait}s 重试)`);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
}

const git = (args, binary = false) =>
  execFileSync('git', args, { maxBuffer: 512 * 1024 * 1024, encoding: binary ? 'buffer' : 'utf8' });

const gitBlobSha = (buf) =>
  createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

// --- read the remote head ---
const headRef = await api(`/git/ref/heads/${BRANCH}`);
const baseSha = headRef.object.sha;
const baseCommit = await api(`/git/commits/${baseSha}`);
console.log('远端', BRANCH, '=', baseSha.slice(0, 7));
console.log('远端 tree       =', baseCommit.tree.sha.slice(0, 7));

// idempotence: already pushed?
const baseTree = await api(`/git/trees/${baseCommit.tree.sha}?recursive=1`);
if (baseTree.tree.some((e) => e.path === PATH_TO_ADD)) {
  console.log(`${PATH_TO_ADD} 已在远端，无需推送。`);
  process.exit(0);
}

// --- build the blobs from the local object DB (rule 3) ---
const localSha = git(['rev-parse', `:${PATH_TO_ADD}`]).trim(); // staged content
const content = git(['cat-file', 'blob', localSha], true);
const want = gitBlobSha(content);

const blob = await api('/git/blobs', 'POST', {
  content: content.toString('base64'), encoding: 'base64',
});
if (blob.sha !== want) {
  console.error(`中止：blob 哈希不符\n  本地 ${want}\n  远端 ${blob.sha}`);
  process.exit(1);
}
console.log('blob 校验通过 =', blob.sha.slice(0, 7), `(${content.length} 字节)`);

// --- tree (rule 1: base_tree, so nothing is dropped) ---
const mode = git(['ls-files', '-s', '--', PATH_TO_ADD]).trim().split(/\s+/)[0] || '100644';
const newTree = await api('/git/trees', 'POST', {
  base_tree: baseCommit.tree.sha,
  tree: [{ path: PATH_TO_ADD, mode, type: 'blob', sha: blob.sha }],
});
console.log('tree 已建 =', newTree.sha.slice(0, 7));

// --- verify the new tree keeps everything and adds exactly our file ---
const verify = await api(`/git/trees/${newTree.sha}?recursive=1`);
const before = new Set(baseTree.tree.map((e) => `${e.path}:${e.sha}`));
const after = new Map(verify.tree.map((e) => [e.path, e.sha]));
if (verify.truncated) { console.error('中止：树被截断，无法校验'); process.exit(1); }
const lost = [...before].filter((k) => !after.has(k.split(':')[0]));
const added = [...after.keys()].filter((p) => !baseTree.tree.some((e) => e.path === p));
if (lost.length) {
  console.error('中止：新树丢失了原有条目\n' + lost.slice(0, 20).join('\n'));
  process.exit(1);
}
if (after.get(PATH_TO_ADD) !== blob.sha) { console.error('中止：新树里的路径内容不对'); process.exit(1); }
console.log(`树上原有 ${baseTree.tree.length} 项全部保留，新增 ${added.length} 项：${added.join(', ')}`);

// --- commit ---
const name = git(['config', 'user.name']).trim();
const email = git(['config', 'user.email']).trim();
const localTree = git(['write-tree']).trim(); // not used, kept for reference
void localTree;
const newCommit = await api('/git/commits', 'POST', {
  message: MESSAGE,
  tree: newTree.sha,
  parents: [baseSha],
  author: { name, email, date: new Date().toISOString() },
});
console.log('提交已建 =', newCommit.sha.slice(0, 7));

// rule 4: remote must not have moved
const recheck = await api(`/git/ref/heads/${BRANCH}`);
if (recheck.object.sha !== baseSha) {
  console.error(`中止：远端已移动（${recheck.object.sha.slice(0, 7)} != ${baseSha.slice(0, 7)}），ref 未更新`);
  process.exit(1);
}

// rule 5: fast-forward only
await api(`/git/refs/heads/${BRANCH}`, 'PATCH', { sha: newCommit.sha, force: false });
console.log(`\n推送完成，远端 ${BRANCH} 现在是 ${newCommit.sha}`);
const finalTree = await api(`/git/trees/${newTree.sha}?recursive=1`);
console.log(`远端新树共 ${finalTree.tree.length} 项，其中 blob ${finalTree.tree.filter((e) => e.type === 'blob').length} 个`);
