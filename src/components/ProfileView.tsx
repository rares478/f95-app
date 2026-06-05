import { useState } from 'react';
import type { ActivityItem, ProfileDto } from '../types';
import { logout } from '../lib/ipc';
import * as ipc from '../lib/ipc';
import { clearCredentials } from '../lib/stronghold';
import { useT } from '../lib/i18n';
import { dialog } from '../lib/dialog';

interface Props {
  profile: ProfileDto;
  onLoggedOut: () => void;
}

type Tab = 'profile-posts' | 'latest-activity' | 'about';

export function ProfileView({ profile, onLoggedOut: _onLoggedOut }: Props) {
  const [working, setWorking] = useState(false);
  const [tab, setTab] = useState<Tab>('latest-activity');

  async function onLogout() {
    setWorking(true);
    try {
      await logout();
      await clearCredentials();
      await ipc.restartToLogin();
    } catch (err) {
      console.error('[logout] failed', err);
      await dialog.alert(String(err), { kind: 'error' });
    } finally {
      setWorking(false);
    }
  }

  return (
    <div style={page}>
      <Header profile={profile} working={working} onLogout={onLogout} />

      <Tabs current={tab} onChange={setTab} />

      <div style={tabBody}>
        {tab === 'profile-posts' && <ProfilePostsTab username={profile.username} />}
        {tab === 'latest-activity' && <ActivityTab items={profile.activity} />}
        {tab === 'about' && <AboutTab profile={profile} />}
      </div>
    </div>
  );
}

function Header({
  profile,
  working,
  onLogout,
}: {
  profile: ProfileDto;
  working: boolean;
  onLogout: () => void;
}) {
  return (
    <div style={headerCard}>
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <Avatar src={profile.avatarUrl} username={profile.username} size={128} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={nameStyle}>{profile.username}</h1>
          {profile.userBanner && <UserBanner text={profile.userBanner} />}
          {profile.customTitle && profile.customTitle !== profile.userBanner && (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 14, marginTop: 4 }}>
              {profile.customTitle}
            </div>
          )}

          <StatsGrid profile={profile} />
        </div>

        <button onClick={onLogout} disabled={working} style={logoutBtn}>
          <LogoutLabel working={working} />
        </button>
      </div>
    </div>
  );
}

function StatsGrid({ profile }: { profile: ProfileDto }) {
  const { t } = useT();
  return (
    <>
      <div style={statsGrid}>
        <Stat label={t('profile.field.messages')} value={profile.messagesCount} />
        <Stat label={t('profile.field.reactions')} value={profile.reactionScore} />
        <Stat label={t('profile.field.points')} value={profile.points} />
        <Stat label={t('profile.field.ratings')} value={profile.ratingsReceived} />
      </div>

      <div style={metaLine}>
        {profile.joinedAt && (
          <span>
            <span style={metaLabel}>{t('profile.field.joinedAt')}:</span> {profile.joinedAt}
          </span>
        )}
        {profile.lastSeen && (
          <span>
            <span style={metaLabel}>{t('profile.field.lastSeen')}:</span> {profile.lastSeen}
          </span>
        )}
      </div>
    </>
  );
}

function LogoutLabel({ working }: { working: boolean }) {
  const { t } = useT();
  return <>{working ? t('settings.account.loggingOut') : t('settings.account.logout')}</>;
}

function Avatar({
  src,
  username,
  size,
}: {
  src: string | null;
  username: string;
  size: number;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={username}
        style={{
          width: size,
          height: size,
          objectFit: 'cover',
          borderRadius: 4,
          background: 'var(--border-faint)',
          flexShrink: 0,
        }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 4,
        background: 'var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.4,
        color: 'var(--text-faint)',
        flexShrink: 0,
      }}
    >
      {username.charAt(0).toUpperCase()}
    </div>
  );
}

function UserBanner({ text }: { text: string }) {
  return (
    <div
      style={{
        display: 'inline-block',
        marginTop: 6,
        padding: '2px 10px',
        borderRadius: 3,
        background: 'var(--status-info)',
        color: 'var(--text-primary)',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: 0.3,
      }}
    >
      {text}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div style={statCell}>
      <div style={statLabel}>{label}</div>
      <div style={statValue}>
        {value === null ? '—' : value.toLocaleString('en-US')}
      </div>
    </div>
  );
}

function Tabs({
  current,
  onChange,
}: {
  current: Tab;
  onChange: (t: Tab) => void;
}) {
  const { t } = useT();
  // Tab labels come from i18n; the `id` stays a stable string for routing.
  const items: { id: Tab; label: string }[] = [
    { id: 'profile-posts', label: 'Profile Posts' },
    { id: 'latest-activity', label: t('profile.tab.activity') },
    { id: 'about', label: t('profile.tab.stats') },
  ];
  return (
    <div style={tabsRow}>
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onChange(it.id)}
          style={{ ...tabBtn, ...(current === it.id ? tabBtnActive : {}) }}
        >
          {it.label.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function ProfilePostsTab({ username }: { username: string }) {
  return (
    <div style={emptyBlock}>There are no messages on {username}'s profile yet.</div>
  );
}

function ActivityTab({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return <div style={emptyBlock}>No recent activity to display.</div>;
  }
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {items.map((it, idx) => (
        <li key={idx} style={activityRow}>
          <Avatar src={it.avatarUrl} username="?" size={48} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={activityTitle}>{it.title}</div>
            {it.snippet && <div style={activitySnippet}>{it.snippet}</div>}
            <div style={activityDate}>{it.date ?? ''}</div>
          </div>
          {it.url && (
            <a href={it.url} target="_blank" rel="noreferrer" style={openLink}>
              open
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function AboutTab({ profile }: { profile: ProfileDto }) {
  const rows: [string, string][] = [];
  if (profile.userId) rows.push(['User ID', `#${profile.userId}`]);
  if (profile.joinedAt) rows.push(['Joined', profile.joinedAt]);
  if (profile.lastSeen) rows.push(['Last seen', profile.lastSeen]);
  if (profile.userBanner) rows.push(['Banner', profile.userBanner]);
  if (profile.customTitle) rows.push(['Title', profile.customTitle]);
  if (profile.messagesCount !== null) rows.push(['Messages', String(profile.messagesCount)]);
  if (profile.reactionScore !== null) rows.push(['Reaction score', String(profile.reactionScore)]);
  if (profile.points !== null) rows.push(['Points', String(profile.points)]);
  if (profile.trophyPoints !== null) rows.push(['Trophy points', String(profile.trophyPoints)]);
  if (profile.ratingsReceived !== null) rows.push(['Ratings received', String(profile.ratingsReceived)]);
  for (const [k, v] of Object.entries(profile.extraStats)) {
    rows.push([k, v]);
  }
  if (profile.profileUrl) rows.push(['Profile URL', profile.profileUrl]);

  return (
    <dl style={aboutGrid}>
      {rows.map(([k, v]) => (
        <div key={k} style={aboutRow}>
          <dt style={aboutKey}>{k}</dt>
          <dd style={aboutVal}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// --- styles ---

const page: React.CSSProperties = {
  maxWidth: 980,
  margin: '0 auto',
  padding: '16px 8px 40px',
  color: 'var(--text-secondary)',
};

const headerCard: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '20px 24px',
};

const nameStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
  color: 'var(--text-primary)',
  margin: 0,
};

const statsGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 24,
  marginTop: 20,
  paddingTop: 16,
  borderTop: '1px solid var(--border)',
};

const statCell: React.CSSProperties = {
  textAlign: 'left',
};

const statLabel: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
  marginBottom: 4,
};

const statValue: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: 'var(--text-primary)',
};

const metaLine: React.CSSProperties = {
  marginTop: 18,
  fontSize: 13,
  color: 'var(--text-muted)',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 18,
};

const metaLabel: React.CSSProperties = {
  color: '#777',
  marginRight: 4,
};

const logoutBtn: React.CSSProperties = {
  alignSelf: 'flex-start',
  padding: '6px 14px',
  background: 'transparent',
  color: 'var(--accent)',
  border: '1px solid var(--accent)',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 0.3,
};

const tabsRow: React.CSSProperties = {
  display: 'flex',
  borderBottom: '1px solid var(--border)',
  marginTop: 24,
  paddingLeft: 8,
};

const tabBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-muted)',
  padding: '12px 18px',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 0.6,
  cursor: 'pointer',
  borderBottom: '3px solid transparent',
  marginBottom: -1,
};

const tabBtnActive: React.CSSProperties = {
  color: 'var(--accent)',
  borderBottom: '3px solid var(--accent)',
};

const tabBody: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderTop: 'none',
  borderRadius: '0 0 6px 6px',
  padding: '8px 0',
};

const emptyBlock: React.CSSProperties = {
  padding: '40px 24px',
  textAlign: 'center',
  color: 'var(--text-muted)',
  fontSize: 14,
};

const activityRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 16,
  padding: '14px 20px',
  borderBottom: '1px solid var(--bg-elevated)',
};

const activityTitle: React.CSSProperties = {
  color: 'var(--text-secondary)',
  fontSize: 14,
  lineHeight: 1.45,
};

const activitySnippet: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: 13,
  fontStyle: 'italic',
  marginTop: 4,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const activityDate: React.CSSProperties = {
  color: '#6c6c6c',
  fontSize: 12,
  marginTop: 6,
};

const openLink: React.CSSProperties = {
  color: 'var(--accent)',
  textDecoration: 'none',
  fontSize: 12,
  alignSelf: 'center',
};

const aboutGrid: React.CSSProperties = {
  margin: 0,
  padding: '8px 0',
};

const aboutRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '180px 1fr',
  gap: 12,
  padding: '8px 24px',
  borderBottom: '1px solid var(--bg-elevated)',
  fontSize: 13,
};

const aboutKey: React.CSSProperties = {
  color: 'var(--text-muted)',
  margin: 0,
};

const aboutVal: React.CSSProperties = {
  color: 'var(--text-secondary)',
  margin: 0,
  wordBreak: 'break-word',
};
