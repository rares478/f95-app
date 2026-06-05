import { Outlet } from 'react-router-dom';
import { DownloadsProvider } from '../contexts/Downloads';
import { DownloadSettingsProvider } from '../contexts/DownloadSettings';
import { StoreSettingsProvider } from '../contexts/StoreSettings';
import { RunningGamesProvider } from '../contexts/RunningGames';
import { NotificationsProvider } from '../contexts/Notifications';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';
import { StatusBar } from './StatusBar';
import { LaunchingOverlay } from './LaunchingOverlay';
import { CatalogBootstrap } from './store/CatalogBootstrap';
import { PrefixCatalogProvider } from '../contexts/PrefixCatalogContext';
import { TagCatalogProvider } from '../contexts/TagCatalogContext';
import type { ProfileDto } from '../types';

interface Props {
  profile: ProfileDto;
  onLoggedOut: () => void;
}

/**
 * App layout: custom title bar across the top (we hide the OS chrome via
 * `decorations: false` in tauri.conf.json), then a flex row below holding
 * the sidebar nav and the routed main content.
 */
export function AppShell({ profile, onLoggedOut }: Props) {
  return (
    <RunningGamesProvider>
      <DownloadSettingsProvider>
        <StoreSettingsProvider>
        <DownloadsProvider>
          <NotificationsProvider initialF95Unread={profile.alerts}>
            <TagCatalogProvider>
              <PrefixCatalogProvider>
                <CatalogBootstrap />
                <div style={rootStyle} className="app-shell">
                  <TitleBar />
                  <div style={bodyStyle} className="app-shell-body">
                    <Sidebar profile={profile} />
                    <main style={contentStyle} className="app-main">
                      <Outlet context={{ profile, onLoggedOut }} />
                    </main>
                  </div>
                  <StatusBar />
                  <LaunchingOverlay />
                </div>
              </PrefixCatalogProvider>
            </TagCatalogProvider>
          </NotificationsProvider>
        </DownloadsProvider>
        </StoreSettingsProvider>
      </DownloadSettingsProvider>
    </RunningGamesProvider>
  );
}

const rootStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  background: 'var(--bg-base)',
  color: 'var(--text-secondary)',
  overflow: 'hidden',
};

const bodyStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'auto',
};
