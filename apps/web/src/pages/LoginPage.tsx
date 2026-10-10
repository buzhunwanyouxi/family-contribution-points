import { useState, type FormEvent } from 'react';
import { useSession } from '../app/session';
import { ApiError } from '../api/client';

type Mode = 'login' | 'register';

/** P01 登录/注册. One field takes either a phone number or an email (contract rule 1). */
export function LoginPage() {
  const { login, register } = useSession();
  const [mode, setMode] = useState<Mode>('login');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        await login({ account: account.trim(), password });
      } else {
        await register({ account: account.trim(), password, nickname: nickname.trim() });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message || '操作失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <div className="login-hero">
        <div className="logo" aria-hidden="true">
          🏠
        </div>
        <h1>家庭贡献评分奖励系统</h1>
        <p>谁做了、做得多好、值多少分、能换什么,全家都看得见</p>
      </div>

      <main className="app-main">
        <section className="card">
          <div className="mode-switch" role="group" aria-label="登录或注册">
            <button type="button" aria-pressed={mode === 'login'} onClick={() => setMode('login')}>
              登录
            </button>
            <button
              type="button"
              aria-pressed={mode === 'register'}
              onClick={() => setMode('register')}
            >
              注册
            </button>
          </div>

          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="account">手机号或邮箱</label>
              <input
                id="account"
                name="account"
                autoComplete="username"
                inputMode="email"
                placeholder="13800000000 或 you@example.com"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                required
              />
            </div>

            {mode === 'register' && (
              <div className="field">
                <label htmlFor="nickname">昵称(家人看到的名字)</label>
                <input
                  id="nickname"
                  name="nickname"
                  maxLength={12}
                  placeholder="例如:弟弟"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  required
                />
              </div>
            )}

            <div className="field">
              <label htmlFor="password">密码</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="至少 6 位"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>

            {error && (
              <p className="error-box" role="alert">
                {error}
              </p>
            )}

            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并继续'}
            </button>
          </form>
        </section>

        <p className="card-note" style={{ textAlign: 'center' }}>
          注册后你可以创建一个家庭,或用家人给你的邀请码加入
        </p>
      </main>
    </div>
  );
}
