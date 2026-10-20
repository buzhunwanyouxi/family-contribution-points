#!/usr/bin/env node
/**
 * 密钥扫描 —— 防止把凭据写进仓库。
 *
 * ## 为什么要有这个
 *
 * 2026-10-20:我把一个真实 DeepSeek API Key 的明文写进了 ops 日志,提交 `b78ac3e` 并推送到
 * **公开仓库**。浏览器自动填充把 key 填进登录框,a11y 读到它的值,我把它当成"证据"抄进了日志。
 *
 * 两件事同时成立:
 *   1. 自动填充会把密钥填进任何看起来像"账号/密码"的表单;
 *   2. 我把看到的东西复述进了一份会被公开的文档。
 *
 * 所以这不是"运气不好",是一条**可复现的路径**。同一个错犯第二次就必须上机制 —— 这是本项目
 * 自己的规矩(`spec-gap` 三次裁决里有两次都是这个形状)。
 *
 * ## 它查什么
 *
 * 只看**被 git 跟踪的文件**(`git ls-files`)。理由:
 *   - 未跟踪文件不会进仓库,报了只是噪音;
 *   - `.env.local` 这类本就该被 gitignore 的东西不该让人每天看到红灯。
 *
 * ## 它不查什么
 *
 * - 不查 git 历史。历史里的旧密钥只能靠**吊销**解决,扫描器帮不上忙,假装能帮更危险。
 * - 不做熵检测。中文文档里长随机串太多,熵检测会淹没在假阳性里。
 *
 * 用法:
 *   node scripts/check-secrets.mjs          # 有问题时退出码 1
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/**
 * 每条规则的 `why` 都写清楚"这是谁家的密钥"。
 * 报错信息里带上它,人才知道该去哪个控制台吊销。
 */
const RULES = [
  {
    name: 'OpenAI 风格 sk- 密钥(DeepSeek / OpenAI / 兼容网关)',
    pattern: /\bsk-[A-Za-z0-9_-]{20,}/g,
    why: '吊销:https://platform.openai.com/api-keys 或 https://platform.deepseek.com/api_keys',
  },
  {
    name: 'GitHub 令牌(ghp_/gho_/ghs_/ghu_/ghr_)',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
    why: '吊销:https://github.com/settings/tokens',
  },
  {
    name: 'AWS Access Key ID',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    why: '吊销:AWS IAM → 该用户 → 停用访问密钥',
  },
  {
    name: 'Slack 令牌',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
    why: '吊销:Slack → App 管理 → OAuth Tokens → Revoke',
  },
  {
    name: 'Anthropic 密钥',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
    why: '吊销:https://console.anthropic.com/settings/keys',
  },
];

/**
 * 允许清单:文档里**故意**出现的假值(说明格式、写测试用例)。
 *
 * 每一条都必须带理由,否则它会被当成"把报警关掉"的补丁,而不是一个决定。
 */
const ALLOWLIST = [
  /sk-ant-\.\.\./, // 文档里说明"Anthropic 的 key 长这样"
  /sk-xxx+/i, // 占位符写法
  /sk-your-key-here/i,
];

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('scripts/check-secrets.mjs'));
}

/** 二进制文件读成 utf8 会得到替换字符,直接跳过比误报好。 */
function looksBinary(buffer) {
  return buffer.subarray(0, 8000).includes(0);
}

const findings = [];
let scanned = 0;

for (const relative of trackedFiles()) {
  const absolute = join(ROOT, relative);
  let buffer;
  try {
    buffer = readFileSync(absolute);
  } catch {
    continue; // 已删除但仍被跟踪的文件
  }
  if (looksBinary(buffer)) continue;

  const text = buffer.toString('utf8');
  scanned += 1;

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      const value = match[0];
      if (ALLOWLIST.some((allow) => allow.test(value))) continue;

      // 只报位置与前缀,不回显完整密钥 —— 否则报告本身又成了泄漏源。
      const line = text.slice(0, match.index).split('\n').length;
      findings.push({
        file: relative,
        line,
        rule: rule.name,
        preview: `${value.slice(0, 8)}…(${value.length} 字符)`,
        why: rule.why,
      });
    }
  }
}

if (findings.length === 0) {
  console.log(`密钥扫描通过(${scanned} 个被跟踪文件,${RULES.length} 条规则)`);
  process.exit(0);
}

console.error(`\n✗ 在 ${findings.length} 处发现疑似密钥:\n`);
for (const finding of findings) {
  console.error(`  ${finding.file}:${finding.line}`);
  console.error(`    ${finding.rule}`);
  console.error(`    前缀 ${finding.preview}`);
  console.error(`    ${finding.why}`);
  console.error('');
}
console.error('处置顺序(别搞反):');
console.error('  1) 先吊销那个密钥 —— 写进 git 就是已泄漏,遮蔽不能撤销已经发生的事');
console.error('  2) 再把文件里的明文改成占位符');
console.error('  3) 提交修正。git 历史里仍有旧值,只有吊销能解决');
process.exit(1);
