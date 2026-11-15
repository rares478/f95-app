import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { openUrl } from '@tauri-apps/plugin-opener';
import { GameDescription } from '../components/game/GameDescription';
import { ScreenshotGallery } from '../components/game/ScreenshotGallery';
import { DownloadLinks } from '../components/game/DownloadLinks';
import {
  GameDetailAside,
  GameDetailBackBar,
  GameDetailBody,
  GameDetailBtnPrimary,
  GameDetailBtnSecondary,
  GameDetailChip,
  GameDetailField,
  GameDetailFields,
  GameDetailMain,
  GameDetailSection,
  GameDetailShell,
  GameDetailTag,
  GameDetailTagList,
  PrefixPill,
} from '../components/game/GameDetailLayout';
import { SocialLinkChips } from '../components/game/SocialLinkChips';
import { DeveloperNameLink } from '../components/developer/DeveloperNameLink';
import { MoreLikeThis } from '../components/game/MoreLikeThis';
import { GameReviews } from '../components/game/GameReviews';
import { useT } from '../lib/i18n';
import type { GameDetail, GamePrefix, GameTag } from '../types/game';
import type { SamCategory } from '../types/sam';
import '../styles/game-page.css';

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

const PURIFY_OPTS = {
  ADD_TAGS: ['details', 'summary', 'button'],
  ADD_ATTR: ['target', 'rel', 'loading', 'type', 'hidden'],
};

export type GamePageDetailProps = {
  data: GameDetail;
  category: SamCategory;
  inLibrary: boolean;
  adding: boolean;
  watched: boolean | null;
  watchBusy: boolean;
  isOffline: boolean;
  onAddToLibrary: () => void | Promise<void>;
  onToggleWatch: () => void;
  onTagClick: (tag: GameTag) => void | Promise<void>;
  onContextMenu: (e: React.MouseEvent) => void;
};

export function GamePageDetail({
  data: g,
  category,
  inLibrary,
  adding,
  watched,
  watchBusy,
  isOffline,
  onAddToLibrary,
  onToggleWatch,
  onTagClick,
  onContextMenu,
}: GamePageDetailProps) {
  const { t } = useT();
  const navigate = useNavigate();
  const [localInLibrary, setLocalInLibrary] = useState(inLibrary);
  const gp = g.gamePage ?? null;

  useEffect(() => {
    setLocalInLibrary(inLibrary);
  }, [inLibrary]);

  const displayPrefixes = normalizeDetailPrefixes(g.prefixes, g.version);
  const plotHtml = DOMPurify.sanitize(g.descriptionHtml, PURIFY_OPTS);
  const coverPositionY = gp?.coverPositionY?.trim() || undefined;
  const whatsNew = gp?.whatsNew ?? null;
  const folds = gp?.folds ?? [];
  const tagGroups = gp?.tagGroups ?? [];
  const stats = gp?.stats ?? null;

  const orderedFields = FIELD_ORDER.filter((k) => g.fields[k]);
  const extraFields = Object.entries(g.fields).filter(
    ([k]) => !FIELD_ORDER.includes(k) && !SKIP_FIELDS.has(k),
  );
  const developerName = (g.fields.Developer ?? g.developer ?? '').trim();
  const showDeveloperRow = Boolean(developerName) || g.social.length > 0;

  return (
    <GameDetailShell onContextMenu={onContextMenu}>
      <GameDetailBackBar
        onBack={() => navigate(-1)}
        breadcrumbTo="/store"
        breadcrumbLabel={t('nav.store')}
      />

      <header className="game-page-hero">
        <div className="game-page-hero-cover">
          {g.bannerUrl ? (
            <img
              src={g.bannerUrl}
              alt=""
              className="game-page-hero-cover-img"
              decoding="async"
              loading="eager"
              style={coverPositionY ? { objectPosition: `center ${coverPositionY}` } : undefined}
            />
          ) : (
            <div className="game-page-hero-cover-fallback" />
          )}
          <div className="game-page-hero-cover-gradient" />
        </div>

        <div className="game-page-hero-body">
          <div className="game-page-hero-main">
            {displayPrefixes.length > 0 && (
              <div className="game-detail-badges">
                {displayPrefixes.map((p) => (
                  <PrefixPill key={p.name} name={p.name} cssClass={p.cssClass} />
                ))}
              </div>
            )}

            <div className="game-page-hero-title-row">
              <h1 className="game-page-hero-title">{g.title}</h1>
              {g.version && <span className="game-page-hero-version">{g.version}</span>}
            </div>

            <div className="game-page-hero-meta">
              {g.developer && (
                <GameDetailChip title={t('gamedetail.meta.developer')}>
                  <DeveloperNameLink name={g.developer} className="developer-name-link" />
                </GameDetailChip>
              )}
              {stats?.likesLabel && (
                <GameDetailChip title={stats.likesTitle ?? undefined}>
                  {stats.likesLabel} {t('gamedetail.meta.likes')}
                </GameDetailChip>
              )}
              {stats?.viewsLabel && (
                <GameDetailChip title={stats.viewsTitle ?? undefined}>
                  {stats.viewsLabel} {t('gamedetail.meta.views')}
                </GameDetailChip>
              )}
              {stats?.repliesLabel && (
                <GameDetailChip title={stats.repliesTitle ?? undefined}>
                  {stats.repliesLabel} {t('gamedetail.meta.replies')}
                </GameDetailChip>
              )}
            </div>

            {g.rating != null && (
              <div
                className="game-page-hero-score"
                title={`${formatRating(g.rating)}${t('gamedetail.reviews.outOf5')}`}
              >
                <span className="game-page-hero-score-star" aria-hidden>
                  ★
                </span>
                {formatRating(g.rating)}
              </div>
            )}
          </div>

          <div className="game-page-hero-actions">
            {localInLibrary ? (
              <GameDetailBtnPrimary as="a" to={`/library/game/${g.threadId}`}>
                {t('gamedetail.action.openInLibrary')}
              </GameDetailBtnPrimary>
            ) : (
              <GameDetailBtnPrimary
                onClick={() => void onAddToLibrary()}
                disabled={adding}
              >
                {adding ? t('gamedetail.action.adding') : t('gamedetail.action.addToLibrary')}
              </GameDetailBtnPrimary>
            )}
            <GameDetailBtnSecondary
              onClick={onToggleWatch}
              disabled={isOffline || watchBusy || watched === null}
            >
              {watchBusy
                ? t('watch.action.watching')
                : watched
                  ? t('watch.action.unwatch')
                  : t('watch.action.watch')}
            </GameDetailBtnSecondary>
            <GameDetailBtnSecondary onClick={() => void openUrl(g.threadUrl)}>
              {t('gamedetail.action.openThread')}
            </GameDetailBtnSecondary>
          </div>
        </div>
      </header>

      <GameDetailBody className="game-page-body">
        <GameDetailMain className="game-page-main">
          {g.screenshots.length > 0 && (
            <GameDetailSection title={t('gamedetail.section.screenshots')}>
              <ScreenshotGallery images={g.screenshots} />
            </GameDetailSection>
          )}

          <GameDetailSection title={t('gamedetail.section.plot')}>
            <GameDescription
              html={plotHtml}
              style={{ fontSize: 13.5, lineHeight: 1.65, wordBreak: 'break-word' }}
            />
          </GameDetailSection>

          {whatsNew && whatsNew.items.length > 0 && (
            <GameDetailSection title={whatsNew.title || t('gamedetail.section.whatsNew')}>
              <ul className="game-page-whats-new-list">
                {whatsNew.items.map((item, i) => (
                  <li key={`${i}-${item.slice(0, 24)}`}>{item}</li>
                ))}
              </ul>
              {whatsNew.historyHref && (
                <div className="game-page-whats-new-actions">
                  <GameDetailBtnSecondary
                    onClick={() => void openUrl(whatsNew.historyHref!)}
                  >
                    {t('gamedetail.section.fullChangelog')}
                  </GameDetailBtnSecondary>
                </div>
              )}
            </GameDetailSection>
          )}

          {folds.length > 0 && (
            <div className="game-page-folds">
              {folds.map((fold) => (
                <details key={fold.title} className="game-page-fold">
                  <summary>{fold.title}</summary>
                  <div className="game-page-fold-body">
                    <GameDescription
                      html={DOMPurify.sanitize(fold.html, PURIFY_OPTS)}
                      style={{ fontSize: 13.5, lineHeight: 1.65, wordBreak: 'break-word' }}
                    />
                  </div>
                </details>
              ))}
            </div>
          )}

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
                tags: g.tags,
                prefixes: g.prefixes,
              }}
              downloads={g.downloads}
              onStarted={() => setLocalInLibrary(true)}
            />
          </GameDetailSection>
        </GameDetailMain>

        <GameDetailAside className="game-page-aside">
          <GameDetailSection title={t('gamedetail.section.facts')}>
            <GameDetailFields>
              {showDeveloperRow && (
                <GameDetailField
                  key="Developer"
                  label="Developer"
                  value={
                    <>
                      <DeveloperNameLink
                        name={developerName}
                        className="developer-name-link game-detail-developer-link"
                      />
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

          {tagGroups.map((group) =>
            group.tags.length > 0 ? (
              <div key={group.key} className="game-page-tag-group">
                <h3 className="game-page-tag-group-title">{group.title}</h3>
                <GameDetailTagList>
                  {group.tags.map((tag) => (
                    <GameDetailTag
                      key={tag.slug}
                      title={t('gamedetail.tag.filterBy', { name: tag.name })}
                      onClick={() => void onTagClick(tag)}
                    >
                      {tag.name}
                    </GameDetailTag>
                  ))}
                </GameDetailTagList>
              </div>
            ) : null,
          )}
        </GameDetailAside>
      </GameDetailBody>

      <div className="game-page-bottom">
        <MoreLikeThis threadId={g.threadId} category={category} tags={g.tags} />
        <GameDetailSection title={t('gamedetail.section.reviews')}>
          <GameReviews threadId={g.threadId} />
        </GameDetailSection>
      </div>
    </GameDetailShell>
  );
}

function formatRating(rating: number): string {
  return Number.isInteger(rating) ? String(rating) : rating.toFixed(1);
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
