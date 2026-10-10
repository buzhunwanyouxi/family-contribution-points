import { AppShell } from '../components/AppShell';
import { PointsCard } from '../components/PointsCard';
import { useSession } from '../app/session';
import { toPointsView } from '../api/types';

/**
 * P11 积分流水. The three numbers stay at the top (F2); the ledger list arrives with the
 * points module (F1: every point must be traceable to who gave it, why and when).
 */
export function PointsPage() {
  const { currentFamily } = useSession();
  const points = currentFamily ? toPointsView(currentFamily) : null;

  return (
    <AppShell title="积分" activePath="/points">
      {points ? <PointsCard points={points} /> : <p className="empty">还没有家庭数据</p>}

      <section className="card">
        <h2>积分明细</h2>
        <p className="empty">
          每一分的来龙去脉在 W3 上线
          <br />
          <span className="card-note">接口:GET /api/families/:fid/points/:uid(见 CONTRACTS.md #15)</span>
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
