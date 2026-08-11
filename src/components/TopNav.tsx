import { NavLink } from 'react-router-dom';
import { NotificationBell } from './NotificationBell';
import { useOffline } from '../contexts/Offline';
import { useT } from '../lib/i18n';
import type { ProfileDto } from '../types';

interface Props {
  profile: ProfileDto;
}

const MAIN_LINKS = [
  { to: '/store', key: 'nav.store' },
  { to: '/library', key: 'nav.library' },
  { to: '/search', key: 'nav.search' },
  { to: '/news', key: 'nav.news' },
  { to: '/friends', key: 'nav.friends' },
] as const;

/**
 * Horizontal header nav — alternative to the left sidebar. Styled via
 * `styles/top-nav.css`.
 */
export function TopNav({ profile }: Props) {
  const { t } = useT();
  const { isOffline } = useOffline();

  return (
    <nav className="app-topnav">
      <div className="app-topnav-links">
        {MAIN_LINKS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `app-topnav-link${isActive ? ' app-topnav-link-active' : ''}`
            }
          >
            {t(item.key)}
          </NavLink>
        ))}
      </div>

      <div className="app-topnav-side">
        <NavLink
          to="/downloads"
          className={({ isActive }) =>
            `app-topnav-icon${isActive ? ' app-topnav-icon-active' : ''}`
          }
          title={t('nav.downloads')}
          aria-label={t('nav.downloads')}
        >
          <IconDownload />
        </NavLink>
        <NotificationBell placement="below" />
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `app-topnav-icon${isActive ? ' app-topnav-icon-active' : ''}`
          }
          title={t('nav.settings')}
          aria-label={t('nav.settings')}
        >
          <IconSettings />
        </NavLink>

        <NavLink
          to="/profile"
          className="app-topnav-user"
          title={t('nav.profile')}
        >
          {profile.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt={profile.username}
              className={`app-topnav-avatar${isOffline ? ' app-topnav-avatar--offline' : ''}`}
            />
          ) : (
            <span
              className={`app-topnav-avatar app-topnav-avatar-fallback${
                isOffline ? ' app-topnav-avatar--offline' : ''
              }`}
            >
              {profile.username.charAt(0).toUpperCase()}
            </span>
          )}
          <span
            className={`app-topnav-username${isOffline ? ' app-topnav-username--offline' : ''}`}
          >
            {profile.username}
          </span>
        </NavLink>
      </div>
    </nav>
  );
}

function IconDownload() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v12" />
      <path d="M6 11l6 6 6-6" />
      <path d="M5 21h14" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3h.1a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8v.1a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </svg>
  );
}
