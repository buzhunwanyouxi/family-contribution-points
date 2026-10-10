import type { ReactNode } from 'react';
import { useNavigate } from '../app/router';
import { USE_MOCK } from '../api/config';

export interface TabDef {
  path: string;
  label: string;
  icon: string;
}

export const TABS: TabDef[] = [
  { path: '/today', label: '今日', icon: '📋' },
  { path: '/family', label: '家庭', icon: '👨‍👩‍👧‍👦' },
  { path: '/points', label: '积分', icon: '⭐' },
  { path: '/me', label: '我的', icon: '🙂' },
];

export interface AppShellProps {
  title: string;
  activePath: string;
  /** shown on the right of the header, e.g. a family switcher */
  headerRight?: ReactNode;
  children: ReactNode;
}

/** Header + content + bottom tab bar. Every logged-in screen renders inside this. */
export function AppShell({ title, activePath, headerRight, children }: AppShellProps) {
  const navigate = useNavigate();

  return (
    <div className="app">
      <header className="app-header">
        <h1>{title}</h1>
        {headerRight}
      </header>

      <main className="app-main">{children}</main>

      {USE_MOCK && <div className="dev-badge">演示数据(mock)</div>}

      <nav className="tabbar" aria-label="主导航">
        {TABS.map((tab) => (
          <button
            key={tab.path}
            type="button"
            aria-current={activePath === tab.path}
            onClick={() => navigate(tab.path)}
          >
            <span className="icon" aria-hidden="true">
              {tab.icon}
            </span>
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
