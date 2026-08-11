import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { cacheThreadPrefixNames } from '../lib/prefixDisplayCache';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { parseSamCategory } from '../constants/samCategories';
import DOMPurify from 'dompurify';
import { openUrl } from '@tauri-apps/plugin-opener';
import * as ipc from '../lib/ipc';
import { dialog } from '../lib/dialog';
import * as library from '../lib/library';
import { saveLinksFromDetail } from '../lib/libraryDownloadLinks';
import { GameDescription } from '../components/game/GameDescription';
import { clearGridPreviewCache } from '../lib/gridPreviewQueue';
import { clearRemoteImageQueue } from '../lib/remoteImageQueue';
import { recordStoreView } from '../lib/storeViewHistory';
import { ScreenshotGallery } from '../components/game/ScreenshotGallery';
import { StoreAchievementsSection } from '../components/game/StoreAchievementsSection';
import { DownloadLinks } from '../components/game/DownloadLinks';
import {
  GameDetailBackBar,
  GameDetailBody,
  GameDetailChip,
  GameDetailError,
  GameDetailField,
  GameDetailFields,
  GameDetailHero,
  GameDetailLoading,
  GameDetailMain,
  GameDetailShell,
  GameDetailSection,
  GameDetailTag,
  GameDetailTagList,
  GameDetailAside,
  GameDetailBtnPrimary,
  GameDetailBtnSecondary,
  PrefixPill,
} from '../components/game/GameDetailLayout';
import { SocialLinkChips } from '../components/game/SocialLinkChips';
import { MoreLikeThis } from '../components/game/MoreLikeThis';
import { ThreadDiscussion } from '../components/game/ThreadDiscussion';
import { useContextMenu } from '../components/contextMenu';
import { useOffline } from '../contexts/Offline';
import { useStoreFilters } from '../contexts/StoreFilters';
import { BROWSE_PATH } from '../lib/browseHandoff';
import { useTagCatalog } from '../contexts/TagCatalogContext';
import { buildStoreMenu } from '../lib/contextMenus/buildStoreMenu';
import { useT } from '../lib/i18n';
import { formatIpcError } from '../lib/ipcError';
import { findSamTagByNameOrSlug } from '../lib/tagCatalog';
import type { GameDetail, GamePrefix, GameTag } from '../types/game';
import type { SamTag } from '../types/sam';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: GameDetail };

const FIELD_ORDER = [
  'Developer',
  'Publisher',
  'Version',
  'Release Date',
  'Thread Updated',
  'OS',
  'Language',
  'Censored',
  'Censorship',
];

const SKIP_FIELDS = new Set(['Overview', 'Genre', 'Installation', 'Changelog']);

/** Not wrapped in OfflineGate: hard-gating remounts this page whenever the
 *  periodic connectivity probe flickers, wiping loaded detail back to loading. */
export function GameDetailPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const [searchParams] = useSearchParams();
  const category = parseSamCategory(searchParams.get('cat'));
  const navigate = useNavigate();
  const { t } = useT();
  const { isOffline } = useOffline();
  const { openMenuAt } = useContextMenu();
  const { catalog } = useTagCatalog();
  const { filterByTag } = useStoreFilters();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [inLibrary, setInLibrary] = useState(false);
  const [adding, setAdding] = useState(false);

  const openDetailContextMenu = useCallback(
    async (e: React.MouseEvent) => {
      if (state.kind !== 'ready') return;
      e.preventDefault();
      e.stopPropagation();
      const data = state.data;
      const inLib = await library.isInLibrary(data.threadId);
      openMenuAt(
        e.clientX,
        e.clientY,
        buildStoreMenu(
          {
            threadId: data.threadId,
            title: data.title,
            threadUrl: data.threadUrl,
            thumbnailUrl: data.bannerUrl,
            version: data.version,
          },
          {
            navigate,
            category,
            isOffline,
            inLibrary: inLib,
            t,
            onLibraryChange: () => setInLibrary(true),
          },
        ),
      );
    },
    [state, navigate, category, isOffline, t, openMenuAt],
  );

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    setState({ kind: 'loading' });
    ipc
      .gameDetail(threadId)
      .then((data) => {
        if (cancelled) return;
        setState({ kind: 'ready', data });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ kind: 'error', message: formatIpcError(err) });
      });
    library
      .isInLibrary(threadId)
      .then((v) => {
        if (!cancelled) setInLibrary(v);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  useEffect(() => {
    if (state.kind !== 'ready') return;
    cacheThreadPrefixNames(
      state.data.threadId,
      state.data.prefixes.map((p) => p.name),
    );
  }, [state]);

  useEffect(() => {
    if (state.kind !== 'ready') return;
    void recordStoreView({
      threadId: state.data.threadId,
      category,
      title: state.data.title,
      thumbnailUrl: state.data.bannerUrl,
      threadUrl: state.data.threadUrl,
    });
  }, [state, category]);

  useEffect(
    () => () => {
      clearRemoteImageQueue();
      clearGridPreviewCache();
    },
    [],
  );

  async function resolveSamTag(tag: GameTag): Promise<SamTag | null> {
    const local = findSamTagByNameOrSlug(catalog, tag);
    if (local) return local;
    try {
      const results = await ipc.samTagSearch(category, tag.name);
      const nameLc = tag.name.trim().toLowerCase();
      const slugLc = tag.slug.trim().toLowerCase();
      return (
        results.find((r) => r.name.trim().toLowerCase() === nameLc) ??
        results.find((r) => r.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === slugLc) ??
        results[0] ??
        null
      );
    } catch (err) {
      console.warn('[gamedetail] tag search failed', err);
      return null;
    }
  }

  async function onTagClick(tag: GameTag) {
    const sam = await resolveSamTag(tag);
    if (!sam) {
      await dialog.alert(t('gamedetail.tag.notFound', { name: tag.name }), { kind: 'info' });
      return;
    }
    filterByTag(sam, category);
    navigate(BROWSE_PATH);
  }

  async function onAddToLibrary() {
    if (state.kind !== 'ready' || adding) return;
    if (isOffline) {
      await dialog.alert(t('offline.actionBlocked'), { kind: 'info' });
      return;
    }
    setAdding(true);
    try {
      await library.add({
        threadId: state.data.threadId,
        category,
        title: state.data.title,
        threadUrl: state.data.threadUrl,
        thumbnailUrl: state.data.bannerUrl,
        currentVersion: state.data.version,
      });
      try {
        await saveLinksFromDetail(state.data.threadId, state.data);
      } catch (err) {
        console.warn('[library] failed to cache download links on add', err);
      }
      setInLibrary(true);
    } catch (err) {
      await dialog.alert(formatIpcError(err), { kind: 'error' });
    } finally {
      setAdding(false);
    }
  }

  if (state.kind === 'loading') {
    return (
      <GameDetailShell>
        <GameDetailBackBar
          onBack={() => navigate(-1)}
          breadcrumbTo="/store"
          breadcrumbLabel={t('nav.store')}
        />
        <GameDetailLoading />
      </GameDetailShell>
    );
  }

  if (state.kind === 'error') {
    return (
      <GameDetailShell>
        <GameDetailBackBar
          onBack={() => navigate(-1)}
          breadcrumbTo="/store"
          breadcrumbLabel={t('nav.store')}
        />
        <GameDetailError message={state.message} />
      </GameDetailShell>
    );
  }

  const g = state.data;
  const displayPrefixes = normalizeDetailPrefixes(g.prefixes, g.version);
  const sanitized = DOMPurify.sanitize(g.descriptionHtml, {
    ADD_TAGS: ['details', 'summary', 'button'],
    ADD_ATTR: ['target', 'rel', 'loading', 'type', 'hidden'],
  });

  const orderedFields = FIELD_ORDER.filter((k) => g.fields[k]);
  const extraFields = Object.entries(g.fields).filter(
    ([k]) => !FIELD_ORDER.includes(k) && !SKIP_FIELDS.has(k),
  );
  const developerName = (g.fields.Developer ?? g.developer ?? '').trim();
  const showDeveloperRow = Boolean(developerName) || g.social.length > 0;

  return (
    <GameDetailShell onContextMenu={openDetailContextMenu}>
      <GameDetailBackBar
        onBack={() => navigate(-1)}
        breadcrumbTo="/store"
        breadcrumbLabel={t('nav.store')}
      />

      <GameDetailHero
        bannerUrl={g.bannerUrl}
        coverUrl={g.bannerUrl}
        badges={
          <>
            {displayPrefixes.map((p) => (
              <PrefixPill key={p.name} name={p.name} cssClass={p.cssClass} />
            ))}
          </>
        }
        title={g.title}
        meta={buildHeroMeta(g, t)}
        tags={
          g.tags.length > 0 ? (
            <GameDetailTagList>
              {g.tags.map((tag) => (
                <GameDetailTag
                  key={tag.slug}
                  title={t('gamedetail.tag.filterBy', { name: tag.name })}
                  onClick={() => void onTagClick(tag)}
                >
                  {tag.name}
                </GameDetailTag>
              ))}
            </GameDetailTagList>
          ) : undefined
        }
        actions={
          <>
            {inLibrary ? (
              <GameDetailBtnPrimary as="a" to={`/library/game/${g.threadId}`}>
                {t('gamedetail.action.openInLibrary')}
              </GameDetailBtnPrimary>
            ) : (
              <GameDetailBtnPrimary onClick={onAddToLibrary} disabled={adding}>
                {adding ? t('gamedetail.action.adding') : t('gamedetail.action.addToLibrary')}
              </GameDetailBtnPrimary>
            )}
            <GameDetailBtnSecondary onClick={() => openUrl(g.threadUrl)}>
              {t('gamedetail.action.openThread')}
            </GameDetailBtnSecondary>
          </>
        }
      />

      <GameDetailBody>
        <GameDetailMain>
          {g.screenshots.length > 0 && (
            <GameDetailSection title={t('gamedetail.section.screenshots')}>
              <ScreenshotGallery images={g.screenshots} />
            </GameDetailSection>
          )}

          <GameDetailSection title={t('gamedetail.section.about')}>
            <GameDescription
              html={sanitized}
              style={{ fontSize: 13.5, lineHeight: 1.65, wordBreak: 'break-word' }}
            />
          </GameDetailSection>

          <MoreLikeThis threadId={g.threadId} category={category} tags={g.tags} />

          <ThreadDiscussion threadId={g.threadId} />
        </GameDetailMain>

        <GameDetailAside>
          <GameDetailSection title={t('gamedetail.section.info')}>
            <GameDetailFields>
              {showDeveloperRow && (
                <GameDetailField
                  key="Developer"
                  label="Developer"
                  value={
                    <>
                      {developerName}
                      <SocialLinkChips links={g.social} />
                    </>
                  }
                />
              )}
              {orderedFields
                .filter((k) => k !== 'Developer')
                .map((k) => (
                  <GameDetailField key={k} label={k} value={g.fields[k]} />
                ))}
              {extraFields
                .filter(([k]) => k !== 'Developer')
                .map(([k, v]) => (
                  <GameDetailField key={k} label={k} value={v} />
                ))}
            </GameDetailFields>
          </GameDetailSection>

          <GameDetailSection title={t('dl.section')} className="game-detail-downloads">
            <DownloadLinks
              embedded
              game={{
                threadId: g.threadId,
                category,
                title: g.title,
                threadUrl: g.threadUrl,
                thumbnailUrl: g.bannerUrl,
                version: g.version,
              }}
              downloads={g.downloads}
              onStarted={() => setInLibrary(true)}
            />
          </GameDetailSection>
        </GameDetailAside>
      </GameDetailBody>
    </GameDetailShell>
  );
}

function normMetaKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Avoid showing the same text twice (e.g. version in Release Date field). */
function metaValuesMatch(a: string, b: string): boolean {
  const ka = normMetaKey(a);
  const kb = normMetaKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.includes(kb) || kb.includes(ka)) {
    if (/\d{4}-\d{2}-\d{2}/.test(ka) || /\d{4}-\d{2}-\d{2}/.test(kb)) return true;
    if (ka.replace(/^v\.?/, '') === kb.replace(/^v\.?/, '')) return true;
  }
  return false;
}

function truncateChip(text: string, max = 52): string {
  const s = text.trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function buildHeroMeta(
  g: GameDetail,
  t: (key: string, vars?: Record<string, string | number>) => string,
) {
  const seen = new Set<string>();
  const chips: ReactNode[] = [];

  const push = (key: string, node: ReactNode) => {
    if (seen.has(key)) return;
    seen.add(key);
    chips.push(node);
  };

  if (g.developer) {
    const key = normMetaKey(g.developer);
    push(
      key,
      <GameDetailChip key={key} title={t('gamedetail.meta.developer')}>
        {g.developer}
      </GameDetailChip>,
    );
  }

  if (g.version) {
    const key = normMetaKey(g.version);
    push(
      key,
      <GameDetailChip key={key} accent title={t('gamedetail.meta.version')}>
        {g.version}
      </GameDetailChip>,
    );
  }

  const release = g.fields['Release Date']?.trim();
  if (release && !metaValuesMatch(release, g.version ?? '')) {
    const updated = g.fields['Thread Updated']?.trim() ?? '';
    if (!updated || !metaValuesMatch(release, updated)) {
      const key = normMetaKey(release);
      push(
        key,
        <GameDetailChip key={key} title={t('gamedetail.meta.releaseDate')}>
          {release}
        </GameDetailChip>,
      );
    }
  }

  const os = g.fields['OS']?.trim();
  if (os) {
    const key = normMetaKey(os);
    push(
      key,
      <GameDetailChip key={key} title={os} className="game-detail-chip-truncate">
        {truncateChip(os)}
      </GameDetailChip>,
    );
  }

  return <>{chips}</>;
}

function normalizeDetailPrefixes(
  prefixes: GamePrefix[],
  version: string | null,
): GamePrefix[] {
  const seen = new Set<string>();
  const out: GamePrefix[] = [];
  const versionKey = version?.trim().toLowerCase() ?? '';

  for (const p of prefixes) {
    const name = p.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (versionKey && key === versionKey) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
