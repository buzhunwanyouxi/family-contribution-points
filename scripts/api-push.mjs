#!/usr/bin/env node
/**
 * Push local commits to GitHub through the REST API.
 *
 * Why this exists: on some networks `github.com:443` is unreachable while `api.github.com` works
 * (the project hit this repeatedly -- see docs/RETROSPECTIVE-初期突发问题复盘.md). Without this
 * script, work simply cannot be published from such a machine.
 *
 * Usage:
 *   GITHUB_TOKEN=... node scripts/api-push.mjs            # push every local-only commit
 *   GITHUB_TOKEN=... node scripts/api-push.mjs <base-sha> # anchor on a commit the remote already has
 *
 * Safety rules baked in, each one earned by a real incident:
 *
 *  1. **Never a flat tree.** Trees are built with `base_tree` = the parent commit's tree, so
 *     unchanged files are inherited. An earlier hand-rolled version replaced the whole tree and
 *     silently dropped 38 files.
 *  2. **Verify before moving the ref.** Every built commit is compared against the local commit
 *     file-by-file (all of them, not just the changed ones) and the push aborts on any difference.
 *  3. **Read blobs from the object database, not the working tree.** `git hash-object <file>` hashes
 *     the WORKING TREE and ignores `.gitattributes`; this repo sets `* text=auto eol=lf`, so the
 *     worktree holds CRLF while the repo holds LF. Hashing the worktree produced mismatches and
 *     would have pushed CRLF content. `git cat-file blob <sha>:<path>` returns the stored bytes.
 *  4. **Refuse to start if the remote moved.** The tree of the first local commit's parent must equal
 *     the tree of the remote head, otherwise someone else pushed and this script stops.
 *  5. **Fast-forward only.** The ref update is issued with `force: false`.
 *
 * Limitations to know about:
 *  - Committer metadata is not reproduced, so the remote commit gets a different sha than the local
 *    one. Content is identical (verified); the shas diverge. Run `git fetch && git reset --hard
 *    origin/main` afterwards to realign the local branch.
 *  - It pushes to the default branch only (`main`). Feature branches are not supported yet.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = process.env.GITHUB_REPO ?? 'buzhunwanyouxi/family-contribution-points';
const BRANCH = process.env.GITHUB_BRANCH ?? 'main';
const TOKEN = process.env.GITHUB_TOKEN;
const API = `https://api.github.com/repos/${REPO}`;
const ANCHOR = process.argv[2];
const KNOWN_ON_REMOTE_FILE = join(ROOT, '.git', 'api-push-anchor');

if (!TOKEN) {
  console.error('缺少 GITHUB_TOKEN 环境变量。用法:GITHUB_TOKEN=ghp_xxx node scripts/api-push.mjs [anchor-sha]');
  process.exit(2);
}

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'fcp-api-push',
  'Content-Type': 'application/json; charset=utf-8',
};

async function api(path, method = 'GET', payload) {
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(API + path, { method, headers: HEADERS, body });
      const text = await response.text();
      const parsed = text.trim() ? JSON.parse(text) : null;
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
      return parsed;
    } catch (error) {
      if (attempt === 6) throw error;
      const wait = 3 * attempt;
      console.error(`    (第 ${attempt} 次失败:${String(error).slice(0, 80)},等 ${wait}s 重试)`);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
  throw new Error('unreachable');
}

/** git with text output; `binary: true` returns a Buffer for exact bytes. */
function git(args, { binary = false } = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: binary ? 'buffer' : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

const text = (args) => String(git(args)).trim();
const blobBytes = (commit, path) => git(['cat-file', 'blob', `${commit}:${path}`], { binary: true });
const blobSha = (commit, path) => text(['rev-parse', `${commit}:${path}`]);

function treeFiles(commit) {
  const out = new Map();
  for (const line of String(git(['ls-tree', '-r', commit])).split('\n')) {
    if (!line.trim()) continue;
    const [meta, path] = line.split('\t');
    out.set(path, meta.split(/\s+/)[2]);
  }
  return out;
}

async function main() {
  const remote = await api(`/commits/${BRANCH}`);
  const remoteSha = remote.sha;
  const head = text(['rev-parse', 'HEAD']);

  // Which commits are local-only? We cannot range over the remote sha (its object usually does not
  // exist locally after an API push), so anchor on the last commit the remote is known to have.
  let anchor = ANCHOR;
  if (!anchor && existsSync(KNOWN_ON_REMOTE_FILE)) anchor = readFileSync(KNOWN_ON_REMOTE_FILE, 'utf8').trim();
  if (!anchor) {
    console.error('无法确定基准提交。请传入远端已有的提交 sha:node scripts/api-push.mjs <sha>');
    process.exit(2);
  }

  const commits = String(git(['log', '--reverse', '--pretty=%H', `${anchor}..${head}`]))
    .split('\n')
    .filter(Boolean);
  if (commits.length === 0) {
    console.log('没有需要推送的提交');
    return;
  }

  console.log(`远端 ${BRANCH} = ${remoteSha.slice(0, 7)}`);
  console.log(`本地 HEAD   = ${head.slice(0, 7)}`);
  console.log(`待推 ${commits.length} 个提交:`);
  for (const sha of commits) console.log(`  ${sha.slice(0, 7)}  ${text(['log', '-1', '--pretty=%s', sha]).slice(0, 64)}`);

  // Rule 4: the local chain must sit exactly on top of what the remote has. Compare tree content,
  // not shas -- API-built commits carry different committer metadata.
  const localParentTree = text(['rev-parse', `${commits[0]}^^{tree}`]);
  const remoteTree = remote.commit.tree.sha;
  if (localParentTree !== remoteTree) {
    console.error(
      `中止:远端 tree (${remoteTree.slice(0, 7)}) 与本地待推提交的父 tree (${localParentTree.slice(0, 7)}) 不一致。\n` +
        '有人推过东西(或本地落后),请先同步再推,不要硬来。',
    );
    process.exit(1);
  }
  console.log(`父提交 tree 一致(${remoteTree.slice(0, 7)})—— 可安全地在上面逐个追加\n`);

  let parent = remoteSha;
  for (const sha of commits) {
    const subject = text(['log', '-1', '--pretty=%s', sha]);
    const message = text(['log', '-1', '--pretty=%B', sha]);
    const author = {
      name: text(['log', '-1', '--pretty=%an', sha]),
      email: text(['log', '-1', '--pretty=%ae', sha]),
      date: text(['log', '-1', '--pretty=%aI', sha]),
    };
    const changed = String(git(['diff', '--name-only', `${sha}~1`, sha])).split('\n').filter(Boolean);
    console.log(`=== ${sha.slice(0, 7)}  ${subject.slice(0, 60)}  (${changed.length} 个文件)`);

    const entries = [];
    for (const path of changed) {
      const bytes = blobBytes(sha, path); // rule 3
      const expected = blobSha(sha, path);
      const blob = await api('/git/blobs', 'POST', {
        content: Buffer.from(bytes).toString('base64'),
        encoding: 'base64',
      });
      if (blob.sha !== expected) {
        console.error(`中止:${path} 上传的 blob (${blob.sha.slice(0, 8)}) 与提交内 (${expected.slice(0, 8)}) 不一致`);
        process.exit(1);
      }
      entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    console.log(`  ${entries.length} 个 blob 已上传,sha 与提交内逐一致 ✓`);

    const parentTree = (await api(`/git/commits/${parent}`)).tree.sha;
    const tree = await api('/git/trees', 'POST', { base_tree: parentTree, tree: entries }); // rule 1
    const commit = await api('/git/commits', 'POST', {
      message,
      tree: tree.sha,
      parents: [parent],
      author,
    });

    // rule 2: verify the whole tree of this commit
    const built = await api(`/git/trees/${commit.sha}?recursive=1`);
    const remoteFiles = new Map(
      built.tree.filter((t) => t.type === 'blob').map((t) => [t.path, t.sha]),
    );
    const localFiles = treeFiles(sha);
    const problems = [];
    for (const [p, s] of localFiles) if (remoteFiles.get(p) !== s) problems.push(p);
    for (const p of remoteFiles.keys()) if (!localFiles.has(p)) problems.push(p);
    if (problems.length) {
      console.error(`中止:校验不通过(${problems.length} 处),不移动 ref:${problems.slice(0, 5).join(', ')}`);
      process.exit(1);
    }
    console.log(`  远端 ${remoteFiles.size} 个文件与本地 ${sha.slice(0, 7)} 逐哈希一致 ✓`);
    parent = commit.sha;
  }

  await api(`/git/refs/heads/${BRANCH}`, 'PATCH', { sha: parent, force: false }); // rule 5
  const after = await api(`/commits/${BRANCH}`);
  console.log(`\n远端 ${BRANCH} 现在 = ${after.sha.slice(0, 7)}`);
  console.log(`内容与本地一致;sha 因 committer 信息不同而不同。`);
  console.log(`建议随后执行:git fetch origin && git reset --hard origin/${BRANCH}`);
  console.log(`\n下次推送到远端之前,把当前远端 sha 记为基准:`);
  console.log(`  echo ${after.sha} > .git/api-push-anchor`);
}

main().catch((error) => {
  console.error(`失败:${error.message ?? error}`);
  process.exit(1);
});
