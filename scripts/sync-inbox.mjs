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
  review: '待评审',
  blocked: '被阻塞',
  'must-know': '必须知道',
};

const KIND_ORDER = ['decision', 'blocked', 'review', 'task', 'must-know'];

/** 尽量拿到当前 commit,拿不到也不致命(容器/裸仓库里没有 git 也能跑)。 */
function headSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
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
  }
  return problems;
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
    let n = 0;
    for (const kind of KIND_ORDER) {
      const group = mine.filter((i) => i.kind === kind);
      if (group.length === 0) continue;
      lines.push(`## ${KIND_LABEL[kind]}(${group.length})`);
      lines.push('');
      for (const item of group) {
        n += 1;
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
  lines.push('## 收工时你应该做的(四件不同的事,别混为一谈)');
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
  lines.push('  5) 收工时要分别做四件事,不要用"跑测试"代替后面三件:');
  lines.push('     a. 验证代码:pnpm -r typecheck && pnpm --filter @fcp/api test,贴原始输出;');
  lines.push('     b. 验证输出:把你这轮产生的需求写进 docs/coordination/PENDING.json,跑 pnpm sync:inbox,提交生成物;');
  lines.push(`     c. 反查收件箱:重读 INBOX-${login}.md,找出"开始时间晚于我这轮开工"的条目(别人在我干活期间提的),念给我听;`);
  lines.push('     d. 检查解锁:看收件箱「谁在等你」一节,你做完的事有没有解除别人的 waiting_on,有就删掉它;');
  lines.push('  6) 提 PR,并写明"已自测通过,请求评审"。');
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

function main() {
  const ledger = loadLedger();
  const problems = validate(ledger);
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
    if (CHECK_ONLY) process.exit(1);
    console.error('(仍会写出收件箱,便于人工查看,但退出码为 1)');
  } else {
    console.log('一致性检查通过');
  }

  if (!CHECK_ONLY) {
    mkdirSync(OUT_DIR, { recursive: true });
    for (const [file, content] of outputs) {
      writeFileSync(file, content, 'utf8');
      console.log(`  写出 ${file.replace(ROOT + '\\', '').replace(ROOT + '/', '')}`);
    }
  }
  console.log(`共 ${ledger.items.length} 条待办,${logins.size} 个人的收件箱${CHECK_ONLY ? '(仅检查,未写入)' : ''}`);
  process.exit(problems.length ? 1 : 0);
}

main();
