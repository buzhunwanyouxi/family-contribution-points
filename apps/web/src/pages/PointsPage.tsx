/**
 * P11 积分页.
 *
 * Before this round the page read `currentFamily` straight out of the session, so the four numbers
 * were whatever `/api/auth/me` returned at login and **never changed again**. The product is "points
 * that move", so a frozen snapshot was the worst possible thing to show -- it looks correct and is
 * silently stale.
 *
 * Now it asks the server (CONTRACTS #15) and keeps the previous value visible while refreshing, so a
 * refresh does not flash zeros.
 */
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { PointsCard } from '../components/PointsCard';
import { pointsResponseToView } from '../api/types';
import type { PointsView } from '../api/types';
import { api } from '../api/client';
import { useSession } from '../app/session';

export function PointsPage() {
  const { currentFamily, user } = useSession();
  const [points, setPoints] = useState<PointsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const familyId = currentFamily?.id ?? null;
  const userId = user?.id ?? null;

  const load = useCallback(async () => {
    if (familyId === null || userId === null) {
      setPoints(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await api.points(familyId, userId);
      setPoints(pointsResponseToView(response));
    } catch (caught) {
      // Keep the old numbers on screen: showing nothing is worse than showing a stale value with an
      // error note, because "0 分" reads like a real answer.
      setError(caught instanceof Error ? caught.message : '积分加载失败');
    } finally {
      setLoading(false);
    }
  }, [familyId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell title="积分" activePath="/points">
      {error !== null && (
        <p className="card-note" role="alert">
          {error}
        </p>
      )}

      {points !== null ? (
        <PointsCard points={points} caption={loading ? '刷新中…' : undefined} />
      ) : (
        <p className="empty">{loading ? '加载中…' : '还没有家庭数据'}</p>
      )}

      <section className="card">
        <h2>积分明细</h2>
        <p className="empty">
          每一分的来龙去脉(谁给的、为什么、什么时候)要等 M6 结算落地
          <br />
          <span className="card-note">
            上面四个数字来自 GET /api/families/:fid/points/:uid(CONTRACTS #15)
          </span>
        </p>
      </section>

      <section className="card">
        <h2>愿望橱窗</h2>
        <p className="empty">
          成员自定义愿望 + 创始人定价 + 全家一起攒分,在 W4 上线(G1-G8)
        </p>
      </section>
    </AppShell>
  );
}
