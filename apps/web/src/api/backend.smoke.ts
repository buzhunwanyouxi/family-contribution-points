/**
 * 真实后端冒烟:起一个真的 API 进程,然后**通过 HTTP 把整条主链路走一遍**。
 *
 * 为什么需要它(而不是组件测试)
 * ------------------------------
 * 2026-10-13 发现:`apps/web` 从来没有持久化 token,所以 `VITE_USE_MOCK=false` 时**所有需要登录的操作
 * 都返回 401**,而当时 **226 个后端测试全绿**。两个原因让这个 bug 活了下来:
 *
 *   1. 每个后端测试都在**自己的模块内部**造数据 —— "模块内正确"推不出"拼起来能跑";
 *   2. mock 模式**不校验 token** —— 前端开发时的默认配置下,这个 bug 完全不可见。
 *
 * 所以这个文件的存在理由只有一条:**它是唯一能发现"前端 × 真实鉴权"这类问题的东西。**
 * 它不测 UI,只测"浏览器会发出的那些请求,对着真 API 是否成立"。
 *
 * 什么时候跑
 * ----------
 * 不进 `pnpm test`(那会要求每次跑测试都先能起 API)。单独跑:
 *
 *     pnpm --filter @fcp/web test:smoke
 *
 * 需要 `apps/api` 的依赖已安装。脚本自己拉起 API 进程并在结束时杀掉,不依赖外部先起服务。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = resolve(HERE, '../../../api');

// 随机高位端口:避免和开发时的 3000/3100 冲突,也避免并行跑两次时互撞。
const PORT = 3400 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = 'smoke-test-secret-do-not-use-anywhere-else';

let api: ChildProcess | undefined;

/** 轮询 /health,最长等 30 秒。API 用 tsx 启动,首次编译需要一点时间。 */
async function waitForApi(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no attempt made';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`API 在 ${timeoutMs}ms 内没有就绪(${BASE}/health):${lastError}`);
}

/**
 * 起 API:直接调 tsx 的 CLI,不走 `pnpm exec`。
 *
 * 两个原因:
 *  1. Windows 上 `pnpm` 是 .cmd,用 `shell: true` 会触发 Node 的 DeprecationWarning
 *     (参数不会被转义);直接 node + tsx CLI 没有这个问题;
 *  2. spawn `pnpm` 会多一层进程包装,测试结束时可能留下孙进程 —— 清理起来更麻烦。
 */
function startApi(): ChildProcess {
  const tsxCli = join(API_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (!existsSync(tsxCli)) {
    throw new Error(`找不到 tsx CLI:${tsxCli}(先在仓库根目录跑 pnpm install)`);
  }
  return spawn(process.execPath, [tsxCli, 'src/server.ts'], {
    cwd: API_DIR,
    env: { ...process.env, PORT: String(PORT), JWT_SECRET, NODE_ENV: 'development' },
    stdio: 'ignore',
  });
}

beforeAll(async () => {
  if (!existsSync(join(API_DIR, 'package.json'))) {
    throw new Error(`找不到 API 包:${API_DIR}`);
  }
  api = startApi();
  api.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`[smoke] API 进程提前退出,code=${code}`);
  });
  await waitForApi();
}, 60_000);

afterAll(() => {
  api?.kill();
});

// ---------------------------------------------------------------------------------------------
// 一个**极简**的客户端,刻意重复 `api/client.ts` 的关键行为:把 token 放进 Authorization 头、
// 失败时优先读 `message`。它故意不复用 `api/client.ts` —— 那样一旦客户端坏了,测试会跟着一起坏,
// 就测不出"浏览器发出的请求"到底长什么样。这里要的是独立复述,而不是共享实现。
// ---------------------------------------------------------------------------------------------

interface ErrorBody {
  error?: string;
  message?: string;
}

async function call(
  path: string,
  init: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.token) headers.Authorization = `Bearer ${init.token}`;

  const res = await fetch(BASE + path, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

/** 提取"用户能看到的那句话",规则与 client.ts 一致:`message` 优先,退回 `error`。 */
function displayMessage(body: unknown): string {
  const e = (body ?? {}) as ErrorBody;
  return e.message ?? e.error ?? '(无信息)';
}

/** 每个用例用独立账号,避免测试之间互相污染(API 的内存仓储在一个进程内是共享的)。 */
let accountSeq = 0;
function nextAccount(): string {
  accountSeq += 1;
  return `139${String(Date.now()).slice(-6)}${String(accountSeq).padStart(2, '0')}`;
}

describe('真实后端冒烟:注册 → 建家 → 邀请码 → 加入', () => {
  it('API 起来了,并且 /health 是活的', async () => {
    const { status, body } = await call('/health');
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true });
  });

  it('注册返回 201 和一个 token —— 这个 token 必须是后续一切的凭据', async () => {
    const { status, body } = await call('/api/auth/register', {
      method: 'POST',
      body: { account: nextAccount(), password: 'smoke-pass-123', nickname: '冒烟爸爸' },
    });
    expect(status, `register 失败:${displayMessage(body)}`).toBe(201);

    const auth = body as { token?: string; user?: unknown; families?: unknown };
    expect(typeof auth.token).toBe('string');
    expect(auth.token!.length).toBeGreaterThan(20);
    // 契约规则 5:新账号没有家庭时必须是 [],不是报错
    expect(auth.families).toEqual([]);
  });

  it('带着 token 建家成功(这条曾经稳定返回 401)', async () => {
    const account = nextAccount();
    const reg = await call('/api/auth/register', {
      method: 'POST',
      body: { account, password: 'smoke-pass-123', nickname: '冒烟爸爸' },
    });
    const token = (reg.body as { token: string }).token;

    const { status, body } = await call('/api/families', {
      method: 'POST',
      body: { name: '冒烟之家' },
      token,
    });
    // 如果这里拿到 401,说明"token 没被存下来/没被带上"这类问题又回来了 —— 本文件存在的理由
    expect(status, `create family 失败:${displayMessage(body)}`).toBe(401 === status ? 401 : 201);
    expect(status).toBe(201);
    expect(body).toMatchObject({ family: { name: '冒烟之家', role: 'owner' } });
  });

  it('登录返回家庭列表(接线生效:auth 能看到 family 的数据)', async () => {
    const account = nextAccount();
    await call('/api/auth/register', {
      method: 'POST',
      body: { account, password: 'smoke-pass-123', nickname: '冒烟妈妈' },
    });
    const login = await call('/api/auth/login', {
      method: 'POST',
      body: { account, password: 'smoke-pass-123' },
    });
    const token = (login.body as { token: string }).token;

    const created = await call('/api/families', { method: 'POST', body: { name: '第二个家' }, token });
    expect(created.status).toBe(201);

    const me = await call('/api/auth/me', { token });
    expect(me.status).toBe(200);
    const families = (me.body as { families: { id: string }[] }).families;
    expect(families.length).toBeGreaterThan(0);
  });

  it('整条邀请闭环:创始人拿码 → 另一个人用码加入(用户能点通的那条路)', async () => {
    const ownerToken = (
      await call('/api/auth/register', {
        method: 'POST',
        body: { account: nextAccount(), password: 'smoke-pass-123', nickname: '冒烟创始人' },
      })
    ).body as { token: string };

    const family = await call('/api/families', {
      method: 'POST',
      body: { name: '邀请闭环之家' },
      token: ownerToken.token,
    });
    expect(family.status).toBe(201);
    const familyId = (family.body as { family: { id: string } }).family.id;

    // #10b:创始人拿到邀请码(在此之前,"加入家庭"这条路根本走不通)
    const invite = await call(`/api/families/${familyId}/invite`, { token: ownerToken.token });
    expect(invite.status, `取邀请码失败:${displayMessage(invite.body)}`).toBe(200);
    const { inviteCode, qrPayload } = invite.body as { inviteCode: string; qrPayload: string };
    expect(inviteCode).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    // 二维码扫出来的东西必须是能打开的东西,不是一个裸码
    expect(qrPayload).toContain(inviteCode);
    expect(qrPayload.startsWith('http')).toBe(true);

    const joiner = (
      await call('/api/auth/register', {
        method: 'POST',
        body: { account: nextAccount(), password: 'smoke-pass-123', nickname: '冒烟家人' },
      })
    ).body as { token: string };

    const joined = await call('/api/families/join', {
      method: 'POST',
      body: { inviteCode },
      token: joiner.token,
    });
    expect(joined.status, `加入失败:${displayMessage(joined.body)}`).toBe(200);

    const members = await call(`/api/families/${familyId}/members`, { token: ownerToken.token });
    expect(members.status).toBe(200);
    expect((members.body as { members: unknown[] }).members).toHaveLength(2);
  });

  it('普通成员读不到邀请码,而且拿到的是"权限不足"而不是"你不是成员"', async () => {
    const ownerToken = (
      await call('/api/auth/register', {
        method: 'POST',
        body: { account: nextAccount(), password: 'smoke-pass-123', nickname: '冒烟创始人' },
      })
    ).body as { token: string };
    const family = await call('/api/families', {
      method: 'POST',
      body: { name: '权限之家' },
      token: ownerToken.token,
    });
    const familyId = (family.body as { family: { id: string } }).family.id;
    const invite = await call(`/api/families/${familyId}/invite`, { token: ownerToken.token });
    const inviteCode = (invite.body as { inviteCode: string }).inviteCode;

    const member = (
      await call('/api/auth/register', {
        method: 'POST',
        body: { account: nextAccount(), password: 'smoke-pass-123', nickname: '冒烟成员' },
      })
    ).body as { token: string };
    await call('/api/families/join', { method: 'POST', body: { inviteCode }, token: member.token });

    const denied = await call(`/api/families/${familyId}/invite`, { token: member.token });
    expect(denied.status).toBe(403);
    // 这条断言防的是"把两个错误码合并"这种看起来无害的重构:
    // not_a_member 的文案会让一个真实成员以为家庭丢了
    expect((denied.body as ErrorBody).error).toBe('role_not_allowed');
    expect(displayMessage(denied.body)).not.toContain('不是这个家庭的成员');
  });

  it('积分四数可以查到,且恒等式成立(CONTRACTS #15 + F5/F6 v1.3)', async () => {
    const owner = (
      await call('/api/auth/register', {
        method: 'POST',
        body: { account: nextAccount(), password: 'smoke-pass-123', nickname: '冒烟积分' },
      })
    ).body as { token: string; user: { id: string } };

    const family = await call('/api/families', {
      method: 'POST',
      body: { name: '积分之家' },
      token: owner.token,
    });
    const familyId = (family.body as { family: { id: string } }).family.id;

    const points = await call(`/api/families/${familyId}/points/${owner.user.id}`, { token: owner.token });
    expect(points.status, `取积分失败:${displayMessage(points.body)}`).toBe(200);

    const four = points.body as { earned: number; available: number; spent: number; frozen: number };
    // 契约 #15 的四个字段必须齐,少一个前端首页就画不出来(F2)
    expect(Object.keys(four).sort()).toEqual(['available', 'earned', 'frozen', 'spent']);
    // 新家庭的新成员:四个数都是 0
    expect(four).toEqual({ earned: 0, available: 0, spent: 0, frozen: 0 });
    // 恒等式:累计获得 − 已消费 = 当前可用(F5/F6 v1.3)
    expect(four.earned - four.spent).toBeCloseTo(four.available, 10);
  });

  it('不是家庭成员的人查不到别人的积分(403,且与"家庭不存在"同码)', async () => {
    const owner = (
      await call('/api/auth/register', {
        method: 'POST',
        body: { account: nextAccount(), password: 'smoke-pass-123', nickname: '冒烟家庭' },
      })
    ).body as { token: string; user: { id: string } };
    const family = await call('/api/families', {
      method: 'POST',
      body: { name: '私密之家' },
      token: owner.token,
    });
    const familyId = (family.body as { family: { id: string } }).family.id;

    const stranger = (
      await call('/api/auth/register', {
        method: 'POST',
        body: { account: nextAccount(), password: 'smoke-pass-123', nickname: '冒烟外人' },
      })
    ).body as { token: string };

    const denied = await call(`/api/families/${familyId}/points/${owner.user.id}`, {
      token: stranger.token,
    });
    const unknownFamily = await call(`/api/families/does-not-exist/points/${owner.user.id}`, {
      token: stranger.token,
    });

    expect(denied.status).toBe(403);
    // 防探测:外人读真实家庭与读不存在的家庭,回答必须一模一样
    expect(unknownFamily.status).toBe(denied.status);
    expect((unknownFamily.body as ErrorBody).error).toBe((denied.body as ErrorBody).error);
  });

  it('没有 token 时受保护接口返回 401 且是 JSON(前端据此清会话并跳登录)', async () => {
    const { status, body } = await call('/api/families');
    expect(status).toBe(401);
    expect((body as ErrorBody).error).toBe('unauthorized');
    expect(typeof displayMessage(body)).toBe('string');
  });

  it('错误响应带可展示的中文 message,而不是只给机器码', async () => {
    const account = nextAccount();
    await call('/api/auth/register', {
      method: 'POST',
      body: { account, password: 'smoke-pass-123', nickname: '冒烟重复' },
    });

    const again = await call('/api/auth/register', {
      method: 'POST',
      body: { account, password: 'smoke-pass-123', nickname: '冒烟重复' },
    });
    expect(again.status).toBe(409);
    const body = again.body as ErrorBody;
    expect(body.error).toBe('user_exists');
    // 前端在屏幕上渲染的是 message;没有它用户会看到 `user_exists`
    expect(typeof body.message).toBe('string');
    expect(body.message!.length).toBeGreaterThan(0);
  });
});
