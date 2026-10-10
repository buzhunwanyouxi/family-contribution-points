import { SessionProvider, useSession } from './app/session';
import { useRoute } from './app/router';
import { LoginPage } from './pages/LoginPage';
import { FamilySetupPage } from './pages/FamilySetupPage';
import { TodayPage } from './pages/TodayPage';
import { FamilyPage } from './pages/FamilyPage';
import { PointsPage } from './pages/PointsPage';
import { MePage } from './pages/MePage';

function Routes() {
  const { status, currentFamily } = useSession();
  const route = useRoute();

  if (status === 'loading') {
    return <div className="center-screen">正在加载…</div>;
  }

  if (status === 'anonymous') {
    return <LoginPage />;
  }

  // Logged in but not in a family yet: everything else is meaningless until this is done.
  if (!currentFamily) {
    return <FamilySetupPage />;
  }

  switch (route.path) {
    case '/family':
      return <FamilyPage />;
    case '/points':
      return <PointsPage />;
    case '/me':
      return <MePage />;
    case '/today':
    default:
      return <TodayPage />;
  }
}

export function App() {
  return (
    <SessionProvider>
      <Routes />
    </SessionProvider>
  );
}
