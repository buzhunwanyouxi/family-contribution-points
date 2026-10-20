/**
 * P03 今日页.
 *
 * Until now both cards were placeholder text saying the endpoints were "待认领" -- while one of them
 * (`#16`) had in fact been implemented. A placeholder that claims something is unbuilt is worse than an
 * empty one: it tells the next person not to look.
 *
 * The task list is real now. It renders empty until M3 (daily generation) exists, and the page says so
 * explicitly instead of letting the emptiness look like a bug.
 */
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { PointsCard } from '../components/PointsCard';
import { pointsResponseToView, INSTANCE_STATUS_LABEL } from '../api/types';
import type { InstanceSummary, PointsView } from '../api/types';
import { api } from '../api/client';
import { useSession } from '../app/session';

/**
 * Today, in the browser's local timezone.
 *
 * Deliberately NOT `toISOString().slice(0,10)`: that is the UTC day, which for a family in
 * Asia/Shanghai is still "yesterday" until 08:00 local. The server stores a natural day, so the client
 * has to name the natural day it means.
 */
function localDateString(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function TodayPage() {
  const { currentFamily, user } = useSession();
  const [points, setPoints] = useState<PointsView | null>(null);
  const [instances, setInstances] = useState<InstanceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const familyId = currentFamily?.id ?? null;
  const userId = user?.id ?? null;

  const load = useCallback(async () => {
    if (familyId === null) {
      setPoints(null);
      setInstances(null);
      return;
    }
    setError(null);

    // Both requests are independent: a failure on one must not blank the other.
    const [pointsResult, instancesResult] = await Promise.allSettled([
      userId === null ? Promise.resolve(null) : api.points(familyId, userId),
      api.instances(familyId, localDateString()),
    ]);

    if (pointsResult.status === 'fulfilled' && pointsResult.value !== null) {
      setPoints(pointsResponseToView(pointsResult.value));
    }
    if (instancesResult.status === 'fulfilled') {
      setInstances(instancesResult.value.instances);
    } else {
      setError(
        instancesResult.reason instanceof Error ? instancesResult.reason.message : '任务加载失败',
      );
    }
  }, [familyId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingScore = (instances ?? []).filter((instance) => instance.status === 'pending_score');

  return (
    <AppShell title={currentFamily ? currentFamily.name : '今日'} activePath="/today">
      {error !== null && (
        <p className="card-note" role="alert">
          {error}
        </p>
      )}

      {points !== null ? (
        <PointsCard points={points} caption={user?.nickname} />
      ) : (
        <p className="empty">还没有家庭数据</p>
      )}

      <section className="card">
        <h2>今日任务</h2>
        {instances === null ? (
          <p className="empty">加载中…</p>
        ) : instances.length === 0 ? (
          <p className="empty">
            今天还没有任务
            <br />
            <span className="card-note">
              自动生成任务(M3)还没做 —— 这不是出错,是还没做。读取接口
              GET /api/families/:fid/instances 已可用(CONTRACTS #16)
            </span>
          </p>
        ) : (
          <ul className="task-list">
            {instances.map((instance) => (
              <li key={instance.id} className="task-item">
                <span className="task-title">{instance.title}</span>
                <span className="task-meta">
                  {instance.maxPoints} 分 · {INSTANCE_STATUS_LABEL[instance.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>待我评分</h2>
        {pendingScore.length === 0 ? (
          <p className="empty">
            暂时没有待评分的任务
            <br />
            <span className="card-note">
              评分接口(#13)在 M5 上线;创始人必评、其他人选评(规则 E1-E14)
            </span>
          </p>
        ) : (
          <ul className="task-list">
            {pendingScore.map((instance) => (
              <li key={instance.id} className="task-item">
                <span className="task-title">{instance.title}</span>
                <span className="task-meta">最高 {instance.maxPoints} 分</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
