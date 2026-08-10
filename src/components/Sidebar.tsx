import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { NotificationBell } from './NotificationBell';
import { useOffline } from '../contexts/Offline';
import { useT } from '../lib/i18n';
import { loadSidebarCollapsed, saveSidebarCollapsed } from '../lib/sidebarLayout';
import type { ProfileDto } from '../types';

interface Props {
  profile: ProfileDto;
}

interface NavItem {
  to: string;
  key: string;
  icon: React.ReactNode;
}

interface NavSection {
  titleKey: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    titleKey: 'nav.section.discover',
    items: [
      { to: '/store', key: 'nav.store', icon: <IconStore /> },
      { to: '/search', key: 'nav.search', icon: <IconSearch /> },
      { to: '/news', key: 'nav.news', icon: <IconNews /> },
      { to: '/friends', key: 'nav.friends', icon: <IconFriends /> },
    ],
  },
  {
    titleKey: 'nav.section.library',
    items: [
      { to: '/library', key: 'nav.library', icon: <IconLibrary /> },
      { to: '/downloads', key: 'nav.downloads', icon: <IconDownload /> },
    ],
  },
  {
    titleKey: 'nav.section.account',
    items: [
      { to: '/profile', key: 'nav.profile', icon: <IconProfile /> },
      { to: '/alerts', key: 'nav.alerts', icon: <IconAlerts /> },
      { to: '/settings', key: 'nav.settings', icon: <IconSettings /> },
    ],
  },
];

export function Sidebar({ profile }: Props) {
  const { t } = useT();
  const { isOffline } = useOffline();
  const [collapsed, setCollapsed] = useState(loadSidebarCollapsed);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      saveSidebarCollapsed(next);
      return next;
    });
  }

  const statusColor = isOffline ? 'var(--status-warning)' : 'var(--status-success)';

  return (
    <aside className={`app-sidebar${collapsed ? ' app-sidebar--collapsed' : ''}`}>
      <div className="app-sidebar-user">
        {profile.avatarUrl ? (
          <img
            src={profile.avatarUrl}
            alt={profile.username}
            className="app-sidebar-avatar"
            title={profile.username}
          />
        ) : (
          <div className="app-sidebar-avatar-fallback" title={profile.username}>
            {profile.username.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="app-sidebar-user-text">
          <div className="app-sidebar-username">{profile.username}</div>
          <div className="app-sidebar-status" style={{ color: statusColor }}>
            <span
              className="app-sidebar-status-dot"
              style={{
                background: statusColor,
                boxShadow: isOffline ? '0 0 6px var(--status-warning)' : '0 0 6px var(--status-success)',
              }}
            />
            {isOffline ? t('nav.offline') : t('nav.online')}
          </div>
        </div>
        <NotificationBell />
      </div>

      <nav className="app-sidebar-nav">
        {NAV_SECTIONS.map((section) => (
          <div key={section.titleKey} className="app-sidebar-section">
            <div className="app-sidebar-section-title">{t(section.titleKey)}</div>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `app-sidebar-link sidebar-link${isActive ? ' sidebar-link-active' : ''}`
                }
                title={collapsed ? t(item.key) : undefined}
              >
                <span className="app-sidebar-link-icon">{item.icon}</span>
                <span className="app-sidebar-link-label">{t(item.key)}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="app-sidebar-footer">
        <button
          type="button"
          className="app-sidebar-toggle"
          onClick={toggleCollapsed}
          aria-label={collapsed ? t('nav.sidebar.expand') : t('nav.sidebar.collapse')}
          title={collapsed ? t('nav.sidebar.expand') : t('nav.sidebar.collapse')}
        >
          <IconSidebarToggle collapsed={collapsed} />
          <span className="app-sidebar-toggle-label">
            {collapsed ? t('nav.sidebar.expand') : t('nav.sidebar.collapse')}
          </span>
        </button>
      </div>
    </aside>
  );
}

function IconSidebarToggle({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      {collapsed ? (
        <>
          <path d="M9 6l6 6-6 6" />
          <path d="M4 6v12" />
        </>
      ) : (
        <>
          <path d="M15 6l-6 6 6 6" />
          <path d="M20 6v12" />
        </>
      )}
    </svg>
  );
}

function IconStore() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M3 9v10a1 1 0 001 1h16a1 1 0 001-1V9" />
      <path d="M9 22V12h6v10" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function IconLibrary() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="18" rx="1" />
      <rect x="14" y="3" width="7" height="11" rx="1" />
      <path d="M14 17h7v4h-7z" />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v12" />
      <path d="M6 11l6 6 6-6" />
      <path d="M5 21h14" />
    </svg>
  );
}

function IconNews() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <path d="M7 8h10M7 12h10M7 16h6" />
    </svg>
  );
}

function IconFriends() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2 21c0-3.5 3-6 7-6s7 2.5 7 6" />
      <circle cx="17" cy="6" r="2.5" />
      <path d="M17 11c2.5 0 5 1.5 5 4.5" />
    </svg>
  );
}

function IconAlerts() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 8a6 6 0 10-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  );
}

function IconProfile() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.5 4-7 8-7s8 2.5 8 7" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3h.1a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8v.1a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </svg>
  );
}
