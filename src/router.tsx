import { createBrowserRouter, Navigate } from 'react-router-dom';
import type { ProfileDto } from './types';
import { AppShell } from './components/AppShell';
import { useOffline } from './contexts/Offline';
import { ProfilePage } from './pages/ProfilePage';
import { StoreBrowsePage } from './pages/StoreBrowsePage';
import { StorePage } from './pages/StorePage';
import { GameDetailPage } from './pages/GameDetailPage';
import { LibraryPage } from './pages/LibraryPage';
import { LibraryGamePage } from './pages/LibraryGamePage';
import { LibraryMediaViewerPage } from './pages/LibraryMediaViewerPage';
import { DownloadsPage } from './pages/DownloadsPage';
import { NewsPage } from './pages/NewsPage';
import { FriendsPage } from './pages/FriendsPage';
import { AlertsPage } from './pages/AlertsPage';
import { SettingsPage } from './pages/SettingsPage';

interface BuildOpts {
  profile: ProfileDto;
  onLoggedOut: () => void;
}

function HomeRedirect() {
  const { isOffline } = useOffline();
  return <Navigate to={isOffline ? '/library' : '/store'} replace />;
}

export function buildRouter({ profile, onLoggedOut }: BuildOpts) {
  return createBrowserRouter([
    {
      path: '/',
      element: <AppShell profile={profile} onLoggedOut={onLoggedOut} />,
      children: [
        { index: true, element: <HomeRedirect /> },
        { path: 'store', element: <StorePage /> },
        { path: 'store/browse', element: <StoreBrowsePage /> },
        { path: 'store/game/:threadId', element: <GameDetailPage /> },
        { path: 'library', element: <LibraryPage /> },
        { path: 'library/game/:threadId', element: <LibraryGamePage /> },
        { path: 'library/game/:threadId/view', element: <LibraryMediaViewerPage /> },
        { path: 'downloads', element: <DownloadsPage /> },
        { path: 'news', element: <NewsPage /> },
        { path: 'friends', element: <FriendsPage /> },
        { path: 'profile', element: <ProfilePage /> },
        { path: 'alerts', element: <AlertsPage /> },
        { path: 'settings', element: <SettingsPage onLoggedOut={onLoggedOut} /> },
        { path: '*', element: <Navigate to="/store" replace /> },
      ],
    },
  ]);
}
