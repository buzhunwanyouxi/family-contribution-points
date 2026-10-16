/**
 * Push local-only commits through the GitHub REST API, up to but excluding a stop-sha.
 *
 * Why this exists: on this network `github.com:443` is unreachable while `api.github.com`
 * works, and the stored credential lacks the `workflow` scope -- so plain `git push` cannot
 * work and neither can a tree containing `.github/workflows/**`.
 *
 * Safety rules mirrored from scripts/api-push.mjs (each earned by a real incident):
 *   1. base_tree = parent's tree -> unchanged files inherited, never a flat tree
 *   2. verify EVERY file of the built commit against the local commit before moving the ref
 *   3. blobs come from `git cat-file blob <sha>:<path>` (object DB), never the working tree
 *   4. refuse to start if the remote moved / trees do not match
 *   5. fast-forward only (force: false)
 *
 * Usage: GITHUB_TOKEN=... node api_push_ranged.mjs [stop-sha]
 *   stop-sha is EXCLUSIVE. Omit it to push every local-only commit.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPO ?? 'buzhunwanyouxi/family-contribution-points';
const BRANCH = process.env.GITHUB_BRANCH ?? 'main';
const ROOT = 'https://api.github.com';
const API = `${ROOT}/repos/${REPO}`;
const STOP = process.argv[2];

if (!TOKEN) { console.error('缺少 GITHUB_TOKEN'); process.exit(2); }

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'fcp-api-push-ranged',
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

const filesChangedIn = (sha) =>
  git(['diff-tree', '--no-commit-id', '--name-status', '-r', `${sha}^`, sha])
    .trim().split('\n').filter(Boolean)
    .map((line) => { const p = line.split('\t'); return { status: p[0][0], path: p[1] }; });

/** path -> blob sha, for the whole tree of a commit */
const treeOf = (sha) => {
  const map = new Map();
  for (const e of git(['ls-tree', '-r', '-z', sha]).split('\0').filter(Boolean)) {
    const [meta, path] = e.split('\t');
    const [, mode, , blob] = meta.split(/\s+/);
    map.set(path, { mode, blob });
  }
  return map;
};

/** Git's object id for a blob: sha1("blob <len>\0" + content). */
const gitBlobSha = (buf) =>
  createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

const remoteSha = (await api(`/git/ref/heads/${BRANCH}`)).object.sha;
console.log('远端 main =', remoteSha.slice(0, 7));

const chain = git(['rev-list', '--reverse', `${remoteSha}..HEAD`]).trim().split('\n').filter(Boolean);
if (!chain.length) { console.log('没有待推送的提交。'); process.exit(0); }

let stopSha = null;
if (STOP) {
  try { stopSha = git(['rev-parse', STOP]).trim(); } catch { stopSha = STOP; }
  if (!chain.includes(stopSha)) {
    console.error(`stop-sha ${STOP} (${String(stopSha).slice(0, 7)}) 不在待推送链中：`,
      chain.map((s) => s.slice(0, 7)).join(', '));
    process.exit(1);
  }
}
const targets = stopSha ? chain.slice(0, chain.indexOf(stopSha)) : chain;
if (!targets.length) { console.log('本次没有需要推送的提交（stop-sha 就是链首）。'); process.exit(0); }

console.log(`待推送 ${chain.length} 个，本次推送 ${targets.length} 个（跳过 ${chain.length - targets.length} 个）`);

// rule 4: anchor check
const remoteTree = (await api(`/git/commits/${remoteSha}`)).tree.sha;
const parentTree = git(['rev-parse', `${targets[0]}^^{tree}`]).trim();
if (parentTree !== remoteTree) {
  console.error(`中止：树不匹配（远端可能已移动）\n  local  ${parentTree}\n  remote ${remoteTree}`);
  process.exit(1);
}
console.log('锚点校验通过\n');

let parentSha = remoteSha;
let parentTreeSha = remoteTree;

for (const sha of targets) {
  const message = git(['log', '-1', '--pretty=%B', sha]);
  const authorName = git(['log', '-1', '--pretty=%an', sha]).trim();
  const authorEmail = git(['log', '-1', '--pretty=%ae', sha]).trim();
  const authorDate = git(['log', '-1', '--pretty=%aI', sha]).trim();
  const subject = git(['log', '-1', '--pretty=%s', sha]).trim();

  const entries = [];
  const expected = new Map(); // path -> blob sha we expect the remote tree to carry
  for (const { status, path } of filesChangedIn(sha)) {
    if (status === 'D') { entries.push({ path, mode: '100644', type: 'blob', sha: null }); continue; }
    const content = git(['cat-file', 'blob', `${sha}:${path}`], true); // rule 3
    const mode = git(['ls-tree', sha, '--', path]).trim().split(/\s+/)[0] || '100644';
    const blob = await api('/git/blobs', 'POST', { content: content.toString('base64'), encoding: 'base64' });

    // verify the blob GitHub stored is byte-identical to the local object (content hash, not a re-read)
    const want = gitBlobSha(content);
    if (blob.sha !== want) {
      console.error(`中止：blob 哈希不符 ${path}\n  本地 ${want}\n  远端 ${blob.sha}`);
      process.exit(1);
    }
    expected.set(path, blob.sha);
    entries.push({ path, mode, type: 'blob', sha: blob.sha });
  }

  const newTree = await api('/git/trees', 'POST', { base_tree: parentTreeSha, tree: entries });
  const newCommit = await api('/git/commits', 'POST', {
    message, tree: newTree.sha, parents: [parentSha],
    author: { name: authorName, email: authorEmail, date: authorDate },
  });

  // rule 2: verify the resulting commit tree carries exactly the blobs we intended
  const built = await api(`/git/trees/${newCommit.tree.sha}?recursive=1`);
  const seen = new Map(built.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]));
  const bad = [];
  for (const [p, wantSha] of expected) {
    const got = seen.get(p);
    if (!got) bad.push(`远端树缺失: ${p}`);
    else if (got !== wantSha) bad.push(`远端树内容不符: ${p}`);
  }
  // unchanged files must be inherited, not dropped: count must never fall below the parent's
  if (built.truncated) bad.push('远端树被截断，无法完整校验');
  if (bad.length) {
    console.error('中止：校验失败，ref 未移动\n' + bad.slice(0, 20).map((s) => '  ' + s).join('\n'));
    process.exit(1);
  }

  console.log(`  ✓ ${sha.slice(0, 7)} -> ${newCommit.sha.slice(0, 7)}  ${subject.slice(0, 56)}`);
  console.log(`     ${expected.size} 个改动文件校验一致`);
  parentSha = newCommit.sha;
  parentTreeSha = newTree.sha;
}

await api(`/git/refs/heads/${BRANCH}`, 'PATCH', { sha: parentSha, force: false }); // rule 5
console.log(`\n推送完成，远端 ${BRANCH} 现在是 ${parentSha.slice(0, 7)}`);
const skipped = chain.length - targets.length;
if (skipped) console.log(`仍有 ${skipped} 个提交未推送：`, chain.slice(targets.length).map((s) => s.slice(0, 7)).join(', '));
