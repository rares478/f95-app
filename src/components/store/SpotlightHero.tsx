import { useEffect, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useStoreContextMenu } from '../../hooks/useStoreContextMenu';
import { useT } from '../../lib/i18n';
import { useIsInLibrary } from '../../lib/libraryMembership';
import type { SamCategory, SamGameCard } from '../../types/sam';
import { ContentTagPills } from './ContentTagPills';
import { PrefixPills } from './PrefixPills';

interface Props {
  slides: SamGameCard[];
  category: SamCategory;
}

const AUTO_ADVANCE_MS = 6000;

/**
 * Layout B spotlight: large active slide + “Up next” queue.
 * Auto-advances every 6s; pauses on hover/focus; selecting a queue row
 * (or dot) switches the active slide and resets the timer.
 */
export function SpotlightHero({ slides, category }: Props) {
  const { t } = useT();
  const { openStoreContextMenu } = useStoreContextMenu(category);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (slides.length === 0) return;
    if (active >= slides.length) setActive(0);
  }, [slides.length, active]);

  useEffect(() => {
    if (paused || slides.length <= 1) return;
    const id = window.setInterval(() => {
      setActive((i) => (i + 1) % slides.length);
    }, AUTO_ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [paused, slides.length, active]);

  if (slides.length === 0) return null;

  const game = slides[Math.min(active, slides.length - 1)]!;
  const detailTo = `/store/game/${game.threadId}?cat=${category}`;

  return (
    <section
      className="spotlight"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setPaused(false);
        }
      }}
    >
      <div className="spotlight-main">
        <SpotlightSlide
          game={game}
          detailTo={detailTo}
          onContextMenu={(e) => void openStoreContextMenu(e, game)}
        />

        {slides.length > 1 && (
          <div className="spotlight-dots" role="tablist" aria-label={t('store.home.upNext')}>
            {slides.map((slide, i) => (
              <button
                key={slide.threadId}
                type="button"
                role="tab"
                aria-selected={i === active}
                className={`spotlight-dot${i === active ? ' is-active' : ''}`}
                onClick={() => setActive(i)}
                title={slide.title}
              />
            ))}
          </div>
        )}
      </div>

      <aside className="spotlight-up-next">
        <h3 className="spotlight-up-next-title">{t('store.home.upNext')}</h3>
        <div className="spotlight-up-next-list">
          {slides.map((slide, i) => (
            <button
              key={slide.threadId}
              type="button"
              className={`spotlight-up-next-item${i === active ? ' is-active' : ''}`}
              aria-current={i === active ? 'true' : undefined}
              onClick={() => setActive(i)}
            >
              <span className="spotlight-up-next-thumb">
                {slide.thumbnailUrl ? (
                  <img src={slide.thumbnailUrl} alt="" loading="lazy" />
                ) : (
                  <span className="spotlight-up-next-fallback">
                    {slide.title.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
              <span className="spotlight-up-next-meta">
                <span className="spotlight-up-next-name">{slide.title}</span>
                {slide.creator && (
                  <span className="spotlight-up-next-creator">{slide.creator}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </aside>
    </section>
  );
}

function SpotlightSlide({
  game,
  detailTo,
  onContextMenu,
}: {
  game: SamGameCard;
  detailTo: string;
  onContextMenu: (e: MouseEvent) => void;
}) {
  const { t } = useT();
  const inLibrary = useIsInLibrary(game.threadId);

  return (
    <Link to={detailTo} className="spotlight-slide" onContextMenu={onContextMenu}>
      {game.thumbnailUrl ? (
        <img
          src={game.thumbnailUrl}
          alt={game.title}
          className="spotlight-slide-img"
          loading="eager"
        />
      ) : (
        <div className="spotlight-slide-fallback">{game.title.slice(0, 1).toUpperCase()}</div>
      )}
      <div className="spotlight-slide-overlay" />

      {inLibrary && (
        <div className="spotlight-library" title={t('store.badge.inLibrary')}>
          {t('store.badge.inLibrary')}
        </div>
      )}

      <div className="spotlight-slide-content">
        <h2 className="spotlight-slide-title">{game.title}</h2>

        <div className="spotlight-slide-meta">
          {game.creator && <span className="spotlight-creator">{game.creator}</span>}
          {game.version && <span className="spotlight-stat">{game.version}</span>}
          {game.rating !== null && (
            <span className="spotlight-stat">
              <span className="spotlight-stat-icon">★</span> {game.rating.toFixed(1)}
            </span>
          )}
          {game.likes !== null && game.likes >= 100 && (
            <span className="spotlight-stat">
              <span className="spotlight-stat-icon">♥</span> {formatCount(game.likes)}
            </span>
          )}
        </div>

        <div className="spotlight-pills">
          <PrefixPills prefixIds={game.prefixIds} threadId={game.threadId} />
        </div>
        <ContentTagPills tagIds={game.tagIds} max={6} />

        <div className="spotlight-cta-row">
          <span className="spotlight-cta">{t('store.featured.viewDetails')} →</span>
        </div>
      </div>
    </Link>
  );
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
