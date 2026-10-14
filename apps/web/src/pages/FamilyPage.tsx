import { useEffect, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { InviteCard } from '../components/InviteCard';
import { api, ApiError } from '../api/client';
import { useSession } from '../app/session';
import { ROLE_LABEL, type MemberSummary } from '../api/types';

/** P12 家庭页: member list + family switcher + invite card (#10b). Charts come in W4 (I1-I6). */
export function FamilyPage() {
  const { currentFamily, families, selectFamily, user } = useSession();
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentFamily) return;
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .members(currentFamily.id)
      .then((result) => {
        if (alive) setMembers(result.members);
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : (err as Error).message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [currentFamily]);

  const switcher =
    families.length > 1 ? (
      <select
        className="tag"
        aria-label="切换家庭"
        value={currentFamily?.id ?? ''}
        onChange={(e) => selectFamily(e.target.value)}
      >
        {families.map((family) => (
          <option key={family.id} value={family.id}>
            {family.name}
          </option>
        ))}
      </select>
    ) : null;

  return (
    <AppShell title="家庭" activePath="/family" headerRight={switcher}>
      <section className="card">
        <h2>成员({members.length})</h2>
        {loading && <p className="empty">加载中…</p>}
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        {!loading && !error && members.length === 0 && <p className="empty">还没有成员</p>}
        {members.map((member) => (
          <div className="member" key={member.userId}>
            <div className="avatar" aria-hidden="true">
              {member.nickname.slice(0, 1)}
            </div>
            <div className="name">
              {member.nickname}
              {member.userId === user?.id && <span className="card-note"> · 我</span>}
            </div>
            <span className={member.role === 'owner' ? 'tag owner' : 'tag'}>
              {ROLE_LABEL[member.role]}
            </span>
          </div>
        ))}
      </section>

      {currentFamily && (
        <InviteCard
          familyId={currentFamily.id}
          canShare={currentFamily.role === 'owner' || currentFamily.role === 'admin'}
        />
      )}

      <section className="card">
        <h2>贡献与报告</h2>
        <p className="empty">
          贡献占比、温和排行榜、月度报告在 W4 上线(I1-I6)
        </p>
      </section>
    </AppShell>
  );
}
