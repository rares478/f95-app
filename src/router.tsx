import { createBrowserRouter, Navigate } from 'react-router-dom';
import type { ProfileDto } from './types';
import { AppShell } from './components/AppShell';
import { useOffline } from './contexts/Offline';
import { ProfilePage } from './pages/ProfilePage';
import { StoreBrowsePage } from './pages/StoreBrowsePage';
import { StoreHomePage } from './pages/StoreHomePage';
import { GameDetailPage } from './pages/GameDetailPage';
import { LibraryLayout } from './components/library/LibraryLayout';
import { LibraryPage } from './pages/LibraryPage';
import { LibraryCollectionPage } from './pages/LibraryCollectionPage';
import { LibraryGamePage } from './pages/LibraryGamePage';
import { LibraryMediaViewerPage } from './pages/LibraryMediaViewerPage';
import { LibrarySaveEditorPage } from './pages/LibrarySaveEditorPage';
import { DownloadsPage } from './pages/DownloadsPage';
import { NewsPage } from './pages/NewsPage';
import { FriendsPage } from './pages/FriendsPage';
import { MemberProfilePage } from './pages/MemberProfilePage';
import { AlertsPage } from './pages/AlertsPage';
import { DeveloperProfilePage } from './pages/DeveloperProfilePage';
import { ForumSearchPage } from './pages/ForumSearchPage';
import { ThreadDetailPage } from './pages/ThreadDetailPage';
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
        { path: 'store', element: <StoreHomePage /> },
        { path: 'store/browse', element: <StoreBrowsePage /> },
        { path: 'store/game/:threadId', element: <GameDetailPage /> },
        { path: 'search', element: <ForumSearchPage /> },
        { path: 'developers/:developerName', element: <DeveloperProfilePage /> },
        { path: 'thread/:threadId', element: <ThreadDetailPage /> },
        { path: 'library', element: <LibraryLayout />, children: [
          { index: true, element: <LibraryPage /> },
          { path: 'collection/:collectionId', element: <LibraryCollectionPage /> },
          { path: 'game/:threadId', element: <LibraryGamePage /> },
        ] },
        { path: 'library/game/:threadId/view', element: <LibraryMediaViewerPage /> },
        { path: 'library/game/:threadId/saves', element: <LibrarySaveEditorPage /> },
        { path: 'downloads', element: <DownloadsPage /> },
        { path: 'news', element: <NewsPage /> },
        { path: 'friends', element: <FriendsPage /> },
        { path: 'members/:userId', element: <MemberProfilePage /> },
        { path: 'profile', element: <ProfilePage /> },
        { path: 'alerts', element: <AlertsPage /> },
        { path: 'settings', element: <SettingsPage onLoggedOut={onLoggedOut} /> },
        { path: '*', element: <Navigate to="/store" replace /> },
      ],
    },
  ]);
}
