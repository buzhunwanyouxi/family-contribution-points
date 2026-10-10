import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { useSession } from '../app/session';
import { ROLE_LABEL } from '../api/types';

/** P02 创建/加入家庭. Shown when the account has no family yet (contract rule 5: empty array). */
export function FamilySetupPage() {
  const { refresh, logout, user } = useSession();
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [familyName, setFamilyName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'create') await api.createFamily({ name: familyName.trim() });
      else await api.joinFamily({ inviteCode: inviteCode.trim() });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message || '操作失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>还没有家庭</h1>
        <button className="tag" type="button" onClick={logout}>
          退出登录
        </button>
      </header>

      <main className="app-main">
        <p className="card-note">
          {user?.nickname},你可以创建一个新家庭成为创始人,或用家人发来的邀请码加入。
        </p>

        <section className="card">
          <div className="mode-switch" role="group" aria-label="创建或加入">
            <button type="button" aria-pressed={mode === 'create'} onClick={() => setMode('create')}>
              创建家庭
            </button>
            <button type="button" aria-pressed={mode === 'join'} onClick={() => setMode('join')}>
              加入家庭
            </button>
          </div>

          <form onSubmit={onSubmit}>
            {mode === 'create' ? (
              <div className="field">
                <label htmlFor="familyName">家庭名称</label>
                <input
                  id="familyName"
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                  placeholder="例如:我们家"
                  maxLength={20}
                  required
                />
              </div>
            ) : (
              <div className="field">
                <label htmlFor="inviteCode">家庭邀请码</label>
                <input
                  id="inviteCode"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="例如:8F3K2Q"
                  maxLength={12}
                  required
                />
              </div>
            )}

            {error && (
              <p className="error-box" role="alert">
                {error}
              </p>
            )}

            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? '请稍候…' : mode === 'create' ? '创建家庭' : '加入家庭'}
            </button>
          </form>
        </section>

        <section className="card">
          <h2>创建家庭后你会得到什么</h2>
          <ul className="card-note" style={{ margin: 0, paddingLeft: 18 }}>
            <li>你是创始人:{ROLE_LABEL.owner},可以创建每天的固定家务任务</li>
            <li>系统生成邀请码,发给家人即可加入(配偶、子女、父母)</li>
            <li>任务完成后上传照片/视频,家人按完成度打分换成积分</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
