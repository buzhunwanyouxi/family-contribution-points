#!/usr/bin/env node
/**
 * 协作消息总线:把仓库状态渲染成"每个人的收件箱"。
 *
 * 设计原则(见 docs/coordination/README.md):
 *   - 仓库是唯一权威:收件箱是**推导物**,任何时候都由脚本重新生成,不接受手工编辑。
 *   - PENDING.json 是唯一的"待办账本";收件箱只是它的视图。
 *   - 消息只负责送达,不负责定义规则 —— 所以每条待办都必须带 source(权威出处)。
 *
 * 用法:
 *   node scripts/sync-inbox.mjs            重新生成三份收件箱
 *   node scripts/sync-inbox.mjs --check    只做一致性检查,不写文件(给 CI / 提交前用)
 *
 * 退出码:一致性问题(来源缺失等)返回 1,否则 0。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PENDING_FILE = join(ROOT, 'docs/coordination/PENDING.json');
const OUT_DIR = join(ROOT, 'docs/coordination');
const STATUS_FILE = join(OUT_DIR, 'STATUS.md');

const CHECK_ONLY = process.argv.includes('--check');

const KIND_LABEL = {
  task: '开工',
  decision: '等拍板',
  'spec-gap': '规则缺口',
  review: '待评审',
  blocked: '被阻塞',
  'must-know': '必须知道',
};

// spec-gap 排在 decision 之后:两者都要人拍板,但 spec-gap 会改变"以后所有同类事情的做法"。
const KIND_ORDER = ['decision', 'spec-gap', 'blocked', 'review', 'task', 'must-know'];

/** 哪些 kind 是人拍板项(渲染时单独成节,并附上"AI 不得自行处置"的提醒)。 */
const HUMAN_KINDS = ['decision', 'spec-gap'];

const SPEC_GAP_STATUS = {
  'pending-human': '待裁决',
  adopted: '已采纳',
  rejected: '已驳回',
};

const CHANGE_KIND_LABEL = { add: '新增', modify: '修改', remove: '删除' };

const SPEC_GAP_REQUIRED = [
  'hit_at',
  'current_spec',
  'proposed',
  'trigger',
  'evidence',
  'change_kind',
  'status',
];

/**
 * 尽量拿到当前 commit,拿不到也不致命。
 *
 * 两条路径:
 *   1. 调 git(SHA 最准,但某些沙箱/受限环境禁止 spawn 子进程,会 EPERM);
 *   2. 直接读 .git/HEAD 与它指向的 ref 文件 —— **不 spawn 任何进程**,
 *      因此在上面的环境里仍能拿到 SHA,而不是悄悄退化成 unknown。
 *
 * 两条都失败才返回 unknown(裸仓库 / 无 .git / 真的没有 git)。
 */
function headSha() {
  const short = (sha) => (sha ? sha.slice(0, 7) : null);
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    /* 落到下面的文件直读 */
  }
  try {
    const head = readFileSync(join(ROOT, '.git', 'HEAD'), 'utf8').trim();
    if (/^[0-9a-f]{40}$/i.test(head)) return short(head); // detached HEAD
    const m = head.match(/^ref:\s*(.+)$/);
    if (m) {
      const refPath = join(ROOT, '.git', m[1]);
      if (existsSync(refPath)) {
        const sha = readFileSync(refPath, 'utf8').trim();
        if (/^[0-9a-f]{40}$/i.test(sha)) return short(sha);
      }
      // 松散引用不存在时,可能在 packed-refs 里
      const packed = join(ROOT, '.git', 'packed-refs');
      if (existsSync(packed)) {
        const line = readFileSync(packed, 'utf8')
          .split('\n')
          .find((l) => l.endsWith(' ' + m[1]));
        if (line) return short(line.split(' ')[0]);
      }
    }
  } catch {
    /* 落空 */
  }
  return 'unknown';
}

function localIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** `docs/CONTRACTS.md#L42` 或 `docs/ROADMAP.md#W1-01` -> 该文件是否存在 */
function sourceFileOf(source) {
  if (!source || source.startsWith('http')) return null;
  return source.split('#')[0];
}

function loadLedger() {
  if (!existsSync(PENDING_FILE)) {
    console.error(`缺少账本文件:${PENDING_FILE}`);
    console.error('修复:从 git 恢复 `git checkout -- docs/coordination/PENDING.json`');
    process.exit(2);
  }
  // Windows 编辑器(PowerShell 的 Set-Content / Out-File)默认会写 UTF-8 BOM,
  // 而 JSON.parse 不接受 BOM 开头的字符串 —— 这里主动剥掉,并给出可操作的提示。
  const raw = readFileSync(PENDING_FILE, 'utf8').replace(/^\uFEFF/, '');
  let ledger;
  try {
    ledger = JSON.parse(raw);
  } catch (err) {
    console.error(`PENDING.json 不是合法 JSON:${err.message}`);
    console.error('常见原因:① 手工编辑时多了/少了逗号或引号;② 文件被编辑器写成了 GBK 编码。');
    console.error('建议:用 `node --check` 无能为力,请用编辑器打开并检查最近改动的那一条。');
    process.exit(2);
  }
  if (!Array.isArray(ledger.items)) {
    console.error('PENDING.json 结构不正确:缺少 items 数组');
    process.exit(2);
  }
  return ledger;
}

function validate(ledger) {
  const problems = [];
  const warnings = [];
  const seen = new Set();

  for (const item of ledger.items) {
    const where = `item "${item.id ?? '(缺少 id)'}"`;

    for (const field of ['id', 'title', 'to', 'kind', 'since', 'source']) {
      if (item[field] === undefined || item[field] === null || item[field] === '') {
        problems.push(`${where} 缺少必填字段 ${field}`);
      }
    }
    if (seen.has(item.id)) problems.push(`${where} id 重复`);
    seen.add(item.id);

    if (item.kind && !KIND_LABEL[item.kind]) {
      problems.push(`${where} 的 kind="${item.kind}" 不是合法值(${Object.keys(KIND_LABEL).join('/')})`);
    }
    if (item.source) {
      const file = sourceFileOf(item.source);
      if (file && !existsSync(join(ROOT, file))) {
        problems.push(`${where} 的 source 指向不存在的文件:${file}`);
      }
    }
    if (item.to && !Array.isArray(item.to)) {
      problems.push(`${where} 的 to 必须是数组`);
    }
    if (item.kind === 'spec-gap') validateSpecGap(item, where, problems, warnings);
  }
  return { problems, warnings };
}

/**
 * spec-gap 专用校验:把 SPEC-GAP.md 里的"三条不对称"变成机械检查。
 * 机制说明:docs/coordination/SPEC-GAP.md
 */
function validateSpecGap(item, where, problems, warnings) {
  for (const field of SPEC_GAP_REQUIRED) {
    if (!item[field]) problems.push(`${where} (spec-gap) 缺少必填字段 ${field}`);
  }

  // 不对称 2:只出提案,不出变更 —— 采纳权在人,needs 只能是"人拍板"
  if (item.needs !== '人拍板') {
    problems.push(
      `${where} (spec-gap) 的 needs 必须是"人拍板"(当前:${JSON.stringify(item.needs ?? null)})` +
        ' —— AI 可以提"规则不够用",但不能自己改规则,也不能把缺口派给 AI 开工',
    );
  }

  if (item.status && !SPEC_GAP_STATUS[item.status]) {
    problems.push(
      `${where} (spec-gap) 的 status="${item.status}" 不是合法值(${Object.keys(SPEC_GAP_STATUS).join('/')})`,
    );
  }

  // 不对称 3:必须留下触发证据 —— 不许写"我觉得应该这样"
  for (const field of ['trigger', 'evidence']) {
    if (typeof item[field] === 'string' && /(我觉得|我认为|建议改|应该改)/.test(item[field])) {
      warnings.push(
        `${where} (spec-gap) 的 ${field} 看起来是主观意见 —— ` +
          '缺口必须指向一个真实发生过的失败案例,而不是"我觉得应该这样"',
      );
    }
  }

  // 不对称 1:只许新增,不许修改/删除 —— 风险不对称,所以 modify/remove 要多一层提醒
  const CHANGE_ARRAY = { add: 'adds', modify: 'modifies', remove: 'removes' };
  const want = CHANGE_ARRAY[item.change_kind];
  if (!want) {
    if (item.change_kind) {
      problems.push(
        `${where} (spec-gap) 的 change_kind="${item.change_kind}" 不是合法值(${Object.keys(CHANGE_ARRAY).join('/')})`,
      );
    }
    return;
  }
  const list = item[want];
  if (!Array.isArray(list) || list.length === 0) {
    problems.push(`${where} (spec-gap) 的 change_kind="${item.change_kind}" 时,${want} 必须是非空数组`);
  }
  if (item.change_kind !== 'add') {
    warnings.push(
      `${where} (spec-gap) 要求"${CHANGE_KIND_LABEL[item.change_kind]}"既有规则 —— ` +
        '注意这是三条不对称里风险最高的一类:改或删一条规则,会让所有依赖它的既有检查一起失效。' +
        '新增最坏是漏检,改/删请务必权衡后再采纳',
    );
  }
}

/** 供 --check 的自检使用:制造一条假条目,验证真正的机制缺陷会被拦住。 */
function selfTest() {
  const fake = (over) => ({
    id: 'selftest', title: 't', to: ['buzhunwanyouxi'], kind: 'spec-gap',
    since: '2026-01-01T00:00:00Z', source: 'AGENTS.md', ...over,
  });
  const cases = [
    ['缺 hit_at', { needs: '人拍板', status: 'pending-human', change_kind: 'add', adds: ['x'] }],
    ['needs 不是人拍板', { hit_at: 'x', current_spec: 'x', proposed: 'x', trigger: 'x', evidence: 'x', change_kind: 'add', adds: ['x'], status: 'pending-human', needs: 'AI 可直接开工' }],
    ['change_kind 非法', { hit_at: 'x', current_spec: 'x', proposed: 'x', trigger: 'x', evidence: 'x', change_kind: 'rewrite', needs: '人拍板', status: 'pending-human' }],
    ['adds 为空', { hit_at: 'x', current_spec: 'x', proposed: 'x', trigger: 'x', evidence: 'x', change_kind: 'add', adds: [], needs: '人拍板', status: 'pending-human' }],
    ['status 非法', { hit_at: 'x', current_spec: 'x', proposed: 'x', trigger: 'x', evidence: 'x', change_kind: 'add', adds: ['x'], needs: '人拍板', status: 'done' }],
  ];
  let ok = true;
  for (const [name, over] of cases) {
    const p = [];
    validateSpecGap(fake(over), 'selftest', p, []);
    if (p.length === 0) {
      console.error(`  ✗ 自检失败:【${name}】本应被拦下,却通过了`);
      ok = false;
    } else {
      console.log(`  ✓ 拦住:${name}`);
    }
  }
  const good = [];
  validateSpecGap(
    fake({ hit_at: 'x', current_spec: 'x', proposed: 'x', trigger: 'x', evidence: 'x',
           change_kind: 'add', adds: ['x'], needs: '人拍板', status: 'pending-human' }),
    'selftest', good, [],
  );
  if (good.length) {
    console.error(`  ✗ 自检失败:合法条目被误杀 → ${good.join('; ')}`);
    ok = false;
  } else {
    console.log('  ✓ 合法条目未被误杀');
  }
  return ok;
}

function itemsFor(login, items) {
  return items
    .filter((i) => Array.isArray(i.to) && i.to.includes(login))
    .sort((a, b) => {
      const k = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
      return k !== 0 ? k : String(a.since).localeCompare(String(b.since));
    });
}

/** 某人是否出现在这条待办的 waiting_on 里(登录名或其显示名都算,但提醒用登录名) */
function itemNamesWaitingOn(item, login) {
  return (item.waiting_on ?? []).some((w) => String(w).toLowerCase() === login.toLowerCase());
}

/** 普通条目(task / review / blocked / must-know / decision)的渲染。 */
function renderKindItem(item, kind, n, lines) {
  lines.push(`### ${n}. ${item.title}`);
  lines.push('');
  lines.push(`- **${KIND_LABEL[kind]}**:${item.action ?? '(见 source)'}`);
  lines.push(`- **从此刻起有效**:${item.since}`);
  lines.push(`- **权威出处**:${item.source}`);
  if (item.needs) lines.push(`- **需要谁**:${item.needs}`);
  if (Array.isArray(item.waiting_on) && item.waiting_on.length) {
    lines.push(`- **要等**:${item.waiting_on.join('、')}`);
  }
  if (item.note) lines.push(`- **备注**:${item.note}`);
  lines.push('');
}

/**
 * spec-gap 的渲染。人拍板项,单独成节并强制附上三条不对称的提醒。
 * 机制说明:docs/coordination/SPEC-GAP.md
 */
function renderSpecGap(item, n, lines) {
  const status = SPEC_GAP_STATUS[item.status] ?? item.status;
  lines.push(`### ${n}. 🧩 ${item.title}`);
  lines.push('');
  lines.push(`- **规则缺口**:${item.action ?? '(见 source)'}`);
  lines.push(`- **撞到它的时刻**:${item.hit_at ?? '(未填)'}  ·  **登记时间**:${item.since}`);
  lines.push(`- **证据出处**:${item.source}`);
  lines.push(`- **裁决状态**:${status}`);

  if (item.current_spec) {
    lines.push('');
    lines.push(`**现行规则**(它没覆盖到的):${item.current_spec}`);
  }
  if (item.trigger) lines.push(`**触发它的真实事件**:${item.trigger}`);
  if (item.evidence) lines.push(`**可核对的证据**:${item.evidence}`);

  lines.push('');
  lines.push(`**建议怎么改**(${CHANGE_KIND_LABEL[item.change_kind] ?? item.change_kind}):${item.proposed}`);
  const detail = { add: item.adds, modify: item.modifies, remove: item.removes }[item.change_kind];
  if (Array.isArray(detail) && detail.length) {
    for (const d of detail) lines.push(`  - ${d}`);
  }

  if (item.change_kind !== 'add') {
    lines.push('');
    lines.push(
      '> ⚠️ 这条要求**改或删**既有规则 —— 三条不对称里风险最高的一类:改/删会让所有依赖它的既有检查一起失效。新增最坏是漏检,采纳前请务必权衡。',
    );
  }

  lines.push('');
  lines.push('> ⚠️ **AI 不得自行处置这一条。** 你只能:①采纳(改权威文档 → 把 status 改成 `adopted` → 在 ops 日志记一笔「哪条规则、谁改的、何时改的」);');
  lines.push('> ②驳回(把 status 改成 `rejected`,**并写明理由** —— 否则下一个 AI 会重新提一遍,而它没有错);③搁置(保留 `pending-human`,在 `note` 里说明为什么不现在处理)。');

  if (item.note) lines.push(`> 备注:${item.note}`);
  lines.push('');
}

function renderInbox(login, items, sha) {
  const mine = itemsFor(login, items);
  const counts = KIND_ORDER.map((k) => [k, mine.filter((i) => i.kind === k).length]).filter(([, n]) => n > 0);

  const summary = counts.length
    ? counts.map(([k, n]) => `${n} 件${KIND_LABEL[k]}`).join(' · ')
    : '暂无待办';

  const lines = [];
  lines.push(`# 收件箱:${login}`);
  lines.push('');
  lines.push('> ⚠️ **本文件由 `scripts/sync-inbox.mjs` 自动生成,不要手工编辑。**');
  lines.push('> 要新增/移除待办,请改 [`PENDING.json`](PENDING.json);要改权威内容,请改 `source` 指向的那份文档。');
  lines.push('');
  lines.push(`**最后生成**:${localIso()} @ \`${sha}\`  ·  **你现在必须知道的**:${summary}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  if (mine.length === 0) {
    lines.push('## 你现在没有待办');
    lines.push('');
    lines.push('这不代表没事可做 —— 去 [`OWNERS.md`](../ai-logs/OWNERS.md) 看有没有空闲模块可以认领,');
    lines.push('或去 [`ROADMAP.md`](../ROADMAP.md) 看有没有标记为"待认领"的行。');
    lines.push('');
  } else {
    // 人拍板项(decision / spec-gap)单独成节,并附上"AI 不得自行处置"的提醒。
    const humanItems = mine.filter((i) => HUMAN_KINDS.includes(i.kind));
    const aiItems = mine.filter((i) => !HUMAN_KINDS.includes(i.kind));
    let n = 0;

    if (humanItems.length) {
      lines.push('## ⚠️ 需要人拍板(这些不是 AI 的任务)');
      lines.push('');
      lines.push('下面这些**必须由人来决定**,AI 不得自行处置、不得代改:');
      lines.push('');
      lines.push('- `decision` — 就这件事做个选择,一次性。');
      lines.push('- `spec-gap` — 规则该改了,**会改变以后所有同类事情的做法**。AI 只能提提案,采纳权在人。');
      lines.push('');
      for (const kind of HUMAN_KINDS) {
        for (const item of humanItems.filter((i) => i.kind === kind)) {
          n += 1;
          if (kind === 'spec-gap') renderSpecGap(item, n, lines);
          else renderKindItem(item, kind, n, lines);
        }
      }
      lines.push('---');
      lines.push('');
    }

    if (aiItems.length) {
      if (humanItems.length) {
        lines.push('## 交给 AI 执行');
        lines.push('');
      }
      for (const kind of KIND_ORDER) {
        if (HUMAN_KINDS.includes(kind)) continue;
        const group = aiItems.filter((i) => i.kind === kind);
        if (group.length === 0) continue;
        for (const item of group) {
          n += 1;
          renderKindItem(item, kind, n, lines);
        }
      }
    }
  }

  // 谁在等我?—— 这是我"做完之后能解锁谁"的依据
  const waitingOnMe = items.filter(
    (i) => Array.isArray(i.waiting_on) && itemNamesWaitingOn(i, login),
  );
  lines.push('---');
  lines.push('');
  lines.push(`## 谁在等你(${waitingOnMe.length})`);
  lines.push('');
  if (waitingOnMe.length === 0) {
    lines.push('暂时没有人的待办写着"要等你"。');
    lines.push('');
  } else {
    lines.push('下面这些待办**卡在你这里**。你收工时如果做完了相关的事,');
    lines.push('请去 [`PENDING.json`](PENDING.json) 把对应的 `waiting_on` 删掉 —— 否则对方不知道已经解锁。');
    lines.push('');
    for (const item of waitingOnMe) {
      const who = (item.to ?? []).join('、');
      lines.push(`- \`${item.id}\` — ${item.title}`);
      lines.push(`  - 卡在:${who} 的这件事要等你完成`);
      lines.push(`  - 出处:${item.source}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## 开工前你应该做的(来自 AGENTS.md 第 0 步)');
  lines.push('');
  lines.push('1. **把上面每一条完整口述给你的使用者**(逐条念,带出处链接)—— 他不知道这些,只能去问发起人。');
  lines.push('2. **不要总结成一句话**:出处链接就是他的核对依据,总结会把它丢掉。');
  lines.push('3. 等你确认后再开始干活。');
  lines.push('');
  lines.push('## 收工时你应该做的(五件不同的事,别混为一谈)');
  lines.push('');
  lines.push('| # | 验证什么 | 怎么做 |');
  lines.push('|---|---|---|');
  lines.push('| ① | 验证**代码** | `pnpm -r typecheck && pnpm --filter @fcp/api test`,贴原始输出 |');
  lines.push('| ② | 验证**输出** | 把你这一轮**产生的需求**写进 `docs/coordination/PENDING.json`,' +
    '跑 `pnpm sync:inbox`,连生成物一起提交 |');
  lines.push('| ③ | **反查收件箱** | **重新读一遍本文件**,找出**开始时间晚于你这轮开工时间**的条目 —— ' +
    '那是别人**在你干活期间**新提的需求。逐条念给使用者听,判断要不要返工 |');
  lines.push('| ④ | **检查解锁** | 看上面的「谁在等你」一节:你做完的事有没有解除别人的 `waiting_on`?' +
    '有就去 `PENDING.json` 把它删掉 —— **否则对方不知道已经解锁** |');
  lines.push('| ⑤ | **记录规则缺口** | 这一轮有没有撞到"规则不够用"?' +
    '**有** → 按 [`SPEC-GAP.md`](SPEC-GAP.md) 提一条 `kind: spec-gap`(只提提案,**不得自行改规则**);' +
    '**没有** → 在 ops 日志里写"无" |');
  lines.push('');
  lines.push('### ⑤ 的判据(别搞错)');
  lines.push('');
  lines.push('| 情况 | 该记成什么 |');
  lines.push('|---|---|');
  lines.push('| 规则**没覆盖**一类情况 / 规则**写得笼统**导致你差点理解错 / **同一类问题被问第二次** | ' +
    '`kind: spec-gap` |');
  lines.push('| 发现了一个 bug | `kind: task`,指给模块负责人 |');
  lines.push('| 需要别人做个决定 | `kind: decision` |');
  lines.push('| 不知道怎么做 | `kind: blocked`,说明卡在哪 |');
  lines.push('| **规则很清楚,只是它让你多做了事** | **什么都不记** —— 这是纪律问题,不是规则问题 |');
  lines.push('');
  lines.push('> ⚠️ **被约束者不得修改约束。** 你只能**记录**缺口,采纳权在人。' +
    '`needs` 必须是"人拍板",`change_kind` 只允许 `add`(改/删既有规则风险高一个量级,要人特别权衡);' +
    '`trigger` / `evidence` 必须指向**真实发生过的失败案例**,不能是"我觉得应该这样"。');
  lines.push('');
  lines.push('> ⚠️ **③ 和 ④ 是反方向的两次检查,都不能省**:');
  lines.push('> ③ 看"**别人给我加了什么**"(新增条目);④ 看"**我给别人解除了什么**"(`waiting_on` 消失)。');
  lines.push('> 只做 ③ 会漏掉解锁信号:被等的人删掉自己那条待办后,等待方重读收件箱**什么也看不到**。');
  lines.push('> ① 只能证明代码没坏,证明不了"你干活期间世界变了"。');
  lines.push('> 若某条新需求让你"差点做错",写进 ops 日志第 8 节;若某条已被你顺带解决,把它从 `PENDING.json` 移除。');
  lines.push('');
  lines.push('### 📋 请把这段话转给你的使用者(他下次开工要用)');
  lines.push('');
  lines.push('```');
  lines.push('下次让我开工时,请把这段提示词贴给我,我会先读收件箱再动手:');
  lines.push('');
  lines.push('  我的 GitHub 登录名是 ' + login + ',请在 family-points 仓库里按项目规则工作。');
  lines.push('  先不要写代码,按顺序做:');
  lines.push(`  1) 读 docs/coordination/INBOX-${login}.md,把每一条完整念给我听(带权威出处链接,不要总结);`);
  lines.push('  2) 读 AGENTS.md、docs/CONTRACTS.md、docs/ai-logs/OWNERS.md 和最近三篇 ops 日志,');
  lines.push('     告诉我:有哪些模块可认领?我要做的事依赖的接口定稿了吗?有什么坑要避开?');
  lines.push('  3) 按 AGENTS.md 第四节填好工作计划,说明我之后怎么验证,然后停下来等我确认;');
  lines.push('  4) 我确认后再干活。如果要认领模块,**先把 OWNERS.md 的认领改动单独提交**,再开始写代码');
  lines.push('     (否则两个人可能同时认领同一个模块,白干一场);');
  lines.push('  5) 收工时要分别做五件事,不要用"跑测试"代替后面四件:');
  lines.push('     a. 验证代码:pnpm -r typecheck && pnpm --filter @fcp/api test,贴原始输出;');
  lines.push('     b. 验证输出:把你这轮产生的需求写进 docs/coordination/PENDING.json,跑 pnpm sync:inbox,提交生成物;');
  lines.push('        ★ 同时更新 OWNERS.md 的进度 —— 改了哪个模块,就把那一行的『状态 / 最后更新 / 实测进度』改掉;');
  lines.push('        (不更新的话,下一个人会照过期的认领表安排工作 —— 那比没有表更危险)');
  lines.push(`     c. 反查收件箱:重读 INBOX-${login}.md,找出"开始时间晚于我这轮开工"的条目(别人在我干活期间提的),念给我听;`);
  lines.push('     d. 检查解锁:看收件箱「谁在等你」一节,你做完的事有没有解除别人的 waiting_on,有就删掉它;');
  lines.push('     e. 记录规则缺口:这一轮有没有撞到"规则不够用"?有 → 按 docs/coordination/SPEC-GAP.md 提一条 kind:spec-gap');
  lines.push('        (只提提案,不得自行改规则;needs 必须是"人拍板");没有 → 在 ops 日志里写"无";');
  lines.push('  6) 提 PR,并写明"已自测通过,请求评审"。');
  lines.push('');
  lines.push('  ⚠️ 注意:AGENTS.md 的规则、PROJECT_GUIDE、CONTRACTS、日志模板、协调机制文件都是');
  lines.push('     约束你的东西,不是你的工作对象。撞到"规则不够用"只能记录(第 5 步 e),不许自己改。');
  lines.push('');
  lines.push('  完整版提示词(含收工检查、卡住时怎么办、以及"AI 跑偏了长什么样"):docs/coordination/PROMPT-TO-AI.md');
  lines.push('```');
  lines.push('');
  lines.push('> 完整模板(含收工提示词、卡住时的提示词、以及"AI 跑偏了长什么样"):');
  lines.push('> [`PROMPT-TO-AI.md`](PROMPT-TO-AI.md)');
  lines.push('');
  lines.push('> 若你发现同一件事**被问过两次**,那是**本系统的问题**,不是沟通问题:');
  lines.push('> 说明这条没进 `PENDING.json`,请补进去 —— 见 [`README.md`](README.md) 的"重复提问即缺陷"。');
  lines.push('');

  return lines.join('\n');
}

function renderStatus(ledger, sha) {
  const items = ledger.items;
  const byLogin = new Map();
  for (const item of items) {
    for (const login of item.to ?? []) {
      byLogin.set(login, (byLogin.get(login) ?? 0) + 1);
    }
  }

  const lines = [];
  lines.push('# 全局待办总览');
  lines.push('');
  lines.push('> ⚠️ **本文件由 `scripts/sync-inbox.mjs` 自动生成,不要手工编辑。**');
  lines.push('');
  lines.push(`**最后生成**:${localIso()} @ \`${sha}\`  ·  共 ${items.length} 条待办`);
  lines.push('');
  lines.push('| 人 | 待办数 | 收件箱 |');
  lines.push('|---|---|---|');
  for (const [login, count] of [...byLogin.entries()].sort()) {
    lines.push(`| ${login} | ${count} | [INBOX-${login}.md](INBOX-${login}.md) |`);
  }
  lines.push('');
  lines.push('## 全部条目');
  lines.push('');
  lines.push('| id | 类型 | 标题 | 发给 | since | 出处 |');
  lines.push('|---|---|---|---|---|---|');
  for (const item of items) {
    lines.push(
      `| \`${item.id}\` | ${KIND_LABEL[item.kind] ?? item.kind} | ${item.title} | ` +
        `${(item.to ?? []).join(', ')} | ${item.since} | ${item.source} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * 收工清单在三处各有一份副本,必须说的是同一件事。
 *
 * 这不是洁癖:2026-10-13 修「自测」歧义时**只改了长版**,收件箱里那份短提示词仍然带着旧写法;
 * 2026-10-14 加第 13 步(记录规则缺口)时**只改了收件箱模板**,PROMPT-TO-AI.md 的收工清单又漏了。
 * 同一个错误犯两次,说明靠"我记得还有一处"是不可靠的 —— 改成机器检查。
 *
 * 只报警不失败(问题的严重度不足以拦住提交),但会打印出来。
 */
const WRAP_UP_STEPS = [
  '验证代码',
  '验证输出',
  '反查收件箱',
  '检查解锁',
  '记录规则缺口',
  // 2026-10-16 新增(spec-gap #3 采纳后):改了模块代码就要更新认领表。
  // 之前 PROMPT-TO-AI.md 里有这一条,AGENTS.md 与收件箱短提示词都没有 —— 又是"改了一处忘了另一处"。
  '更新 OWNERS.md 的进度',
];

function checkWrapUpPromptConsistency(warnings) {
  const copies = [
    ['收件箱模板(scripts/sync-inbox.mjs 内的短提示词)', 'scripts/sync-inbox.mjs'],
    ['长版提示词(docs/coordination/PROMPT-TO-AI.md)', 'docs/coordination/PROMPT-TO-AI.md'],
    ['固定动作表(AGENTS.md)', 'AGENTS.md'],
  ];

  for (const [label, rel] of copies) {
    const file = join(ROOT, rel);
    if (!existsSync(file)) {
      warnings.push(`${label} 不存在,无法核对收工清单一致性:${rel}`);
      continue;
    }
    // Backticks are stripped before matching: the same instruction is written as `OWNERS.md` in one
    // copy and plain OWNERS.md in another, and a formatting difference should not read as a missing step.
    const text = readFileSync(file, 'utf8').replace(/`/g, '');
    const missing = WRAP_UP_STEPS.filter((step) => !text.includes(step));
    if (missing.length) {
      warnings.push(
        `${label} 的收工清单缺 ${missing.length} 项(${missing.join('、')})—— ` +
          `完整清单共 ${WRAP_UP_STEPS.length} 项:${WRAP_UP_STEPS.join(' / ')}。` +
          '改了其中一处请同步其余副本(已有两次漏改记录)',
      );
    }
  }
}

function main() {
  if (process.argv.includes('--self-test')) {
    console.log('机制自检:注入 5 类坏 spec-gap + 1 条合法条目,验证拦得住、不误杀');
    process.exit(selfTest() ? 0 : 1);
  }

  const ledger = loadLedger();
  const { problems, warnings } = validate(ledger);
  checkWrapUpPromptConsistency(warnings);
  const sha = headSha();
  const logins = new Set();
  for (const item of ledger.items) for (const l of item.to ?? []) logins.add(l);
  for (const l of ledger.people ?? []) logins.add(l);

  const outputs = [];
  for (const login of [...logins].sort()) {
    outputs.push([join(OUT_DIR, `INBOX-${login}.md`), renderInbox(login, ledger.items, sha)]);
  }
  outputs.push([STATUS_FILE, renderStatus(ledger, sha)]);

  if (problems.length) {
    console.error('一致性检查发现问题:');
    for (const p of problems) console.error(`  - ${p}`);
    console.error('\n请修正 docs/coordination/PENDING.json 后重试。');
  }
  if (warnings.length) {
    console.error('提醒(不阻断,但请人工看一眼):');
    for (const w of warnings) console.error(`  - ${w}`);
  }

  if (!problems.length && !warnings.length) {
    console.log('一致性检查通过');
  } else if (!problems.length) {
    console.log('一致性检查通过(有提醒,见上)');
  }

  if (!CHECK_ONLY) {
    mkdirSync(OUT_DIR, { recursive: true });
    for (const [file, content] of outputs) {
      writeFileSync(file, content, 'utf8');
      console.log(`  写出 ${file.replace(ROOT + '\\', '').replace(ROOT + '/', '')}`);
    }
  }
  console.log(
    `共 ${ledger.items.length} 条待办,${logins.size} 个人的收件箱${CHECK_ONLY ? '(仅检查,未写入)' : ''}`,
  );
  process.exit(problems.length ? 1 : 0);
}

main();
