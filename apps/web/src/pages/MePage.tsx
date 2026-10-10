import { AppShell } from '../components/AppShell';
import { useSession } from '../app/session';
import { USE_MOCK } from '../api/config';
import { ROLE_LABEL } from '../api/types';

/** P19 我的: account info, the add-to-home-screen hint, and logout. */
export function MePage() {
  const { user, currentFamily, families, selectFamily, logout } = useSession();

  return (
    <AppShell title="我的" activePath="/me">
      <section className="card">
        <h2>{user?.nickname}</h2>
        <p className="card-note" style={{ margin: 0 }}>
          {user?.phone ?? user?.email}
          {currentFamily && <> · {currentFamily.name} · {ROLE_LABEL[currentFamily.role]}</>}
        </p>
      </section>

      {families.length > 1 && (
        <section className="card">
          <h2>切换家庭</h2>
          {families.map((family) => (
            <div className="member" key={family.id}>
              <div className="name">{family.name}</div>
              <button
                className="tag"
                type="button"
                disabled={family.id === currentFamily?.id}
                onClick={() => selectFamily(family.id)}
              >
                {family.id === currentFamily?.id ? '当前' : '切换'}
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <h2>把应用放到手机桌面</h2>
        <ul className="card-note" style={{ margin: 0, paddingLeft: 18 }}>
          <li>安卓 Chrome / Edge:右上角菜单 → 添加到主屏幕</li>
          <li>华为/小米自带浏览器:菜单 → 添加到桌面</li>
          <li>iPhone Safari:分享按钮 → 添加到主屏幕</li>
        </ul>
        <p className="card-note" style={{ marginBottom: 0 }}>
          加完之后像 App 一样全屏打开,而且永远不用重新安装。
        </p>
      </section>

      <section className="card">
        <h2>运行状态</h2>
        <p className="card-note" style={{ margin: 0 }}>
          {USE_MOCK
            ? '演示数据模式:所有请求都由前端 mock 回答,还没有连后端。'
            : '已连接真实后端。'}
        </p>
      </section>

      <button className="btn btn-secondary" type="button" onClick={logout}>
        退出登录
      </button>
    </AppShell>
  );
}
