import { AppShell } from '../components/AppShell';
import { PointsCard } from '../components/PointsCard';
import { useSession } from '../app/session';
import { toPointsView } from '../api/types';

/** P03 首页(今日). Points card first (F2), then the place the task feed will live in W2. */
export function TodayPage() {
  const { currentFamily, user } = useSession();
  const points = currentFamily ? toPointsView(currentFamily) : null;

  return (
    <AppShell title={currentFamily ? currentFamily.name : '今日'} activePath="/today">
      {points ? (
        <PointsCard points={points} caption={user?.nickname} />
      ) : (
        <p className="empty">还没有家庭数据</p>
      )}

      <section className="card">
        <h2>今日任务</h2>
        <p className="empty">
          任务列表将在 W2 上线
          <br />
          <span className="card-note">
            后端接口:GET /api/families/:fid/instances?date=today(见 CONTRACTS.md,待认领)
          </span>
        </p>
      </section>

      <section className="card">
        <h2>待我评分</h2>
        <p className="empty">
          创始人必评、其他人选评(规则 E1-E14)
          <br />
          <span className="card-note">接口:GET /api/families/:fid/instances?status=pending_score</span>
        </p>
      </section>
    </AppShell>
  );
}
