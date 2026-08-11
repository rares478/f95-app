import { useCallback, useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { openUrl } from '@tauri-apps/plugin-opener';
import type {
  ActivityItem,
  PaginatedActivity,
  PaginatedProfilePosts,
  ProfileBadge,
  ProfileDto,
  ProfilePostItem,
} from '../types';
import { logout } from '../lib/ipc';
import * as ipc from '../lib/ipc';
import * as library from '../lib/library';
import { clearCredentials } from '../lib/stronghold';
import { useT, type TFunction } from '../lib/i18n';
import { dialog } from '../lib/dialog';
import { GameDescription } from './game/GameDescription';
import { Spinner } from './ui/Spinner';

interface Props {
  profile: ProfileDto;
  mode?: 'self' | 'member';
  onLoggedOut?: () => void;
  onBack?: () => void;
}

interface LibraryStats {
  total: number;
  installed: number;
  playtimeSeconds: number;
  mostPlayed: LibraryGame | null;
}

function sanitizeProfileHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['details', 'summary', 'button'],
    ADD_ATTR: ['target', 'rel', 'loading', 'type', 'hidden'],
  });
}

export function ProfileView({
  profile,
  mode = 'self',
  onLoggedOut: _onLoggedOut,
  onBack,
}: Props) {
  const [working, setWorking] = useState(false);
  const [tab, setTab] = useState<Tab>('latest-activity');
  const isMember = mode === 'member';
  const userId = profile.userId ?? undefined;

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

  const mostPlayedLabel =
    libStats?.mostPlayed && (libStats.mostPlayed.totalPlaytimeSeconds ?? 0) > 0
      ? libStats.mostPlayed.title
      : '—';

  return (
    <div className="profile-page">
      <Header
        profile={profile}
        working={working}
        isMember={isMember}
        onLogout={onLogout}
        onBack={onBack}
      />

      <Tabs current={tab} onChange={setTab} />

      <div className="profile-tab-body">
        {tab === 'profile-posts' && userId && (
          <ProfilePostsTab username={profile.username} userId={userId} />
        )}
        {tab === 'profile-posts' && !userId && (
          <ProfilePostsTabStatic
            username={profile.username}
            posts={profile.profilePosts ?? []}
          />
        )}
        {tab === 'latest-activity' && userId && (
          <ActivityTab userId={userId} />
        )}
        {tab === 'latest-activity' && !userId && (
          <ActivityTabStatic items={profile.activity} />
        )}
        {tab === 'about' && <AboutTab profile={profile} />}
      </div>
    </div>
  );
}

function ProfilePager({
  page,
  totalPages,
  hasMore,
  loading,
  onPage,
}: {
  page: number;
  totalPages: number | null;
  hasMore: boolean;
  loading: boolean;
  onPage: (page: number) => void;
}) {
  const { t } = useT();
  const show =
    page > 1 || hasMore || (totalPages != null && totalPages > 1);
  if (!show) return null;

  const canPrev = page > 1 && !loading;
  const canNext = hasMore && !loading;
  const label =
    totalPages != null
      ? t('gamedetail.discussion.pageOf', { page, total: totalPages })
      : `${page}`;

  return (
    <div className="profile-pager">
      <button
        type="button"
        className="profile-pager-btn"
        disabled={!canPrev}
        onClick={() => onPage(page - 1)}
      >
        {t('gamedetail.discussion.prev')}
      </button>
      <span className="profile-pager-label">{label}</span>
      <button
        type="button"
        className="profile-pager-btn"
        disabled={!canNext}
        onClick={() => onPage(page + 1)}
      >
        {t('gamedetail.discussion.next')}
      </button>
    </div>
  );
}

function ProfilePostsTab({
  username,
  userId,
}: {
  username: string;
  userId: string;
}) {
  const { t } = useT();
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PaginatedProfilePosts | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await ipc.getMemberProfilePosts(userId, page);
      setData(result);
    } catch (err) {
      setError(String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [userId, page]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="profile-empty">
        <Spinner size="sm" />
      </div>
    );
  }
  if (error) {
    return <div className="profile-empty">{error}</div>;
  }
  if (!data || data.items.length === 0) {
    return (
      <div className="profile-empty">
        {t('profile.posts.empty', { username })}
      </div>
    );
  }

  return (
    <>
      <ProfilePostsList posts={data.items} />
      <ProfilePager
        page={data.page}
        totalPages={data.totalPages}
        hasMore={data.hasMore}
        loading={loading}
        onPage={setPage}
      />
    </>
  );
}

function ActivityTab({ userId }: { userId: string }) {
  const { t } = useT();
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PaginatedActivity | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await ipc.getMemberActivity(userId, page);
      setData(result);
    } catch (err) {
      setError(String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [userId, page]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="profile-empty">
        <Spinner size="sm" />
      </div>
    );
  }
  if (error) {
    return <div className="profile-empty">{error}</div>;
  }
  if (!data || data.items.length === 0) {
    return <div className="profile-empty">{t('profile.activity.empty')}</div>;
  }

  return (
    <>
      <ActivityList items={data.items} />
      <ProfilePager
        page={data.page}
        totalPages={data.totalPages}
        hasMore={data.hasMore}
        loading={loading}
        onPage={setPage}
      />
    </>
  );
}

function ProfilePostsTabStatic({
  username,
  posts,
}: {
  username: string;
  posts: ProfilePostItem[];
}) {
  const { t } = useT();
  if (posts.length === 0) {
    return (
      <div className="profile-empty">
        {t('profile.posts.empty', { username })}
      </div>
    );
  }
  return <ProfilePostsList posts={posts} />;
}

function ActivityTabStatic({ items }: { items: ActivityItem[] }) {
  const { t } = useT();
  if (items.length === 0) {
    return <div className="profile-empty">{t('profile.activity.empty')}</div>;
  }
  return <ActivityList items={items} />;
}

function ProfilePostsList({ posts }: { posts: ProfilePostItem[] }) {
  return (
    <ul className="profile-list">
      {posts.map((post, idx) => (
        <li key={`${post.url ?? post.authorName}-${post.date ?? idx}`} className="profile-list-item">
          <Avatar src={post.authorAvatarUrl} username={post.authorName} size={48} />
          <div className="profile-list-main">
            <div className="profile-list-title">{post.authorName}</div>
            {post.messageHtml ? (
              <GameDescription
                html={sanitizeProfileHtml(post.messageHtml)}
                className="profile-list-body"
              />
            ) : (
              <div className="profile-list-snippet">{post.messageText}</div>
            )}
            {post.date && <div className="profile-list-date">{post.date}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ActivityList({ items }: { items: ActivityItem[] }) {
  return (
    <ul className="profile-list">
      {items.map((it, idx) => (
        <li key={it.url ?? idx} className="profile-list-item">
          <Avatar src={it.avatarUrl} username="?" size={48} />
          <div className="profile-list-main">
            <div className="profile-list-title">{it.title}</div>
            {it.snippet && <div className="profile-list-snippet">{it.snippet}</div>}
            {it.date && <div className="profile-list-date">{it.date}</div>}
          </div>
          {it.url && (
            <button
              type="button"
              onClick={() => openUrl(it.url!)}
              className="profile-open-link"
            >
              open
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Header({
  profile,
  working,
  isMember,
  onLogout,
  onBack,
}: {
  profile: ProfileDto;
  working: boolean;
  isMember: boolean;
  onLogout: () => void;
  onBack?: () => void;
}) {
  const { t } = useT();
  const badges = profile.userBanners ?? [];

  return (
    <div className="profile-header">
      {isMember && onBack && (
        <button type="button" onClick={onBack} className="profile-back-btn">
          {t('common.back')}
        </button>
      )}
      <div className="profile-header-top">
        <div className="profile-header-row profile-header-main">
          <div className="profile-avatar">
            <Avatar src={profile.avatarUrl} username={profile.username} size={128} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="profile-name">{profile.username}</h1>
            {profile.customTitle && (
              <div className="profile-custom-title">{profile.customTitle}</div>
            )}
            {badges.length > 0 && <BadgesRow badges={badges} />}
            {(profile.tags?.length ?? 0) > 0 && (
              <TagsRow tags={profile.tags ?? []} />
            )}
            <StatsGrid profile={profile} />
          </div>
        </div>

        <div className="profile-header-actions">
          {isMember ? (
            profile.profileUrl && (
              <button
                type="button"
                onClick={() => openUrl(profile.profileUrl!)}
                className="profile-action-btn"
              >
                {t('profile.openOnF95')}
              </button>
            )
          ) : (
            <button
              onClick={onLogout}
              disabled={working}
              className="profile-action-btn"
            >
              <LogoutLabel working={working} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function BadgesRow({ badges }: { badges: ProfileBadge[] }) {
  return (
    <div className="profile-badges">
      {badges.map((badge) => (
        <span
          key={badge.label}
          className={`profile-badge profile-badge--${badge.variant}`}
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
}

function TagsRow({ tags }: { tags: string[] }) {
  return (
    <div className="profile-tags">
      {tags.map((tag) => (
        <span key={tag} className="profile-tag">
          {tag}
        </span>
      ))}
    </div>
  );
}

function StatsGrid({ profile }: { profile: ProfileDto }) {
  const { t } = useT();
  return (
    <>
      <div className="profile-stats">
        <Stat label={t('profile.field.messages')} value={profile.messagesCount} />
        <Stat label={t('profile.field.reactions')} value={profile.reactionScore} />
        <Stat label={t('profile.field.points')} value={profile.points} />
        <Stat label={t('profile.field.ratings')} value={profile.ratingsReceived} />
        <Stat label={t('profile.field.trophies')} value={profile.trophyPoints} />
        <Stat label={t('profile.field.donations')} text={profile.donations} />
      </div>

      <div className="profile-meta">
        {profile.joinedAt && (
          <span>
            <span className="profile-meta-label">{t('profile.field.joinedAt')}:</span>{' '}
            {profile.joinedAt}
          </span>
        )}
        {profile.lastSeen && (
          <span>
            <span className="profile-meta-label">{t('profile.field.lastSeen')}:</span>{' '}
            {profile.lastSeen}
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
        className="profile-avatar-img"
        style={{ width: size, height: size, background: 'var(--border-faint)' }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }
  return (
    <div
      className="profile-avatar-fallback"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {username.charAt(0).toUpperCase()}
    </div>
  );
}

function Stat({
  label,
  value,
  text,
}: {
  label: string;
  value?: number | null;
  text?: string | null;
}) {
  const display =
    text ??
    (value === null || value === undefined ? '—' : value.toLocaleString('en-US'));
  return (
    <div>
      <div className="profile-stat-label">{label}</div>
      <div className="profile-stat-value">{display}</div>
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
  const items: { id: Tab; label: string }[] = [
    { id: 'profile-posts', label: t('profile.tab.posts') },
    { id: 'latest-activity', label: t('profile.tab.activity') },
    { id: 'about', label: t('profile.tab.stats') },
  ];
  return (
    <div className="profile-tabs">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onChange(it.id)}
          className={`profile-tab${current === it.id ? ' profile-tab--active' : ''}`}
        >
          {it.label.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function AboutTab({ profile }: { profile: ProfileDto }) {
  const { t } = useT();
  const rows: [string, string][] = [];
  if (profile.userId) rows.push(['User ID', `#${profile.userId}`]);
  if (profile.joinedAt) rows.push([t('profile.field.joinedAt'), profile.joinedAt]);
  if (profile.lastSeen) rows.push([t('profile.field.lastSeen'), profile.lastSeen]);
  if (profile.customTitle) rows.push(['Title', profile.customTitle]);
  if ((profile.userBanners?.length ?? 0) > 0) {
    rows.push([
      t('profile.field.badges'),
      profile.userBanners!.map((b) => b.label).join(', '),
    ]);
  }
  if (profile.messagesCount !== null) {
    rows.push([t('profile.field.messages'), String(profile.messagesCount)]);
  }
  if (profile.reactionScore !== null) {
    rows.push([t('profile.field.reactions'), String(profile.reactionScore)]);
  }
  if (profile.points !== null) rows.push([t('profile.field.points'), String(profile.points)]);
  if (profile.trophyPoints !== null) {
    rows.push([t('profile.field.trophies'), String(profile.trophyPoints)]);
  }
  if (profile.ratingsReceived !== null) {
    rows.push([t('profile.field.ratings'), String(profile.ratingsReceived)]);
  }
  if (profile.donations) {
    rows.push([t('profile.field.donations'), profile.donations]);
  }
  if ((profile.tags?.length ?? 0) > 0) {
    rows.push([t('profile.field.tags'), profile.tags!.join(', ')]);
  }
  for (const [k, v] of Object.entries(profile.extraStats)) {
    rows.push([k, v]);
  }
  if (profile.profileUrl) rows.push(['Profile URL', profile.profileUrl]);

  return (
    <dl className="profile-about-grid">
      {rows.map(([k, v]) => (
        <div key={k} className="profile-about-row">
          <dt className="profile-about-key">{k}</dt>
          <dd className="profile-about-val">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
