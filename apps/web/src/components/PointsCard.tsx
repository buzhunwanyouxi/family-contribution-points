import type { PointsView } from '../api/types';

function fmt(value: number): string {
  // keep one decimal only when there is one: 1.2 stays 1.2, 3 stays 3
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '');
}

export interface PointsCardProps {
  points: PointsView;
  /** optional caption, e.g. the family name */
  caption?: string;
}

/**
 * PROJECT_GUIDE F2: 累计获得 / 当前可用 / 已消费 must ALWAYS be shown together.
 * Never render a bare balance anywhere else in the app.
 */
export function PointsCard({ points, caption }: PointsCardProps) {
  return (
    <section className="card points-card" aria-label="我的积分">
      <div className="points-row">
        <span className="big">{fmt(points.available)}</span>
        <span className="unit">分可用{caption ? ` · ${caption}` : ''}</span>
      </div>

      <div className="points-grid">
        <div className="cell">
          <div className="value">{fmt(points.earned)}</div>
          <div className="label">累计获得</div>
        </div>
        <div className="cell">
          <div className="value">{fmt(points.available)}</div>
          <div className="label">当前可用</div>
        </div>
        <div className="cell">
          <div className="value">{fmt(points.spent)}</div>
          <div className="label">已消费</div>
        </div>
      </div>

      {points.frozen > 0 && (
        <p className="points-extra">
          其中 {fmt(points.frozen)} 分已冻结(发布了还没人做的悬赏),实际可花 {fmt(points.spendable)} 分
        </p>
      )}
    </section>
  );
}
