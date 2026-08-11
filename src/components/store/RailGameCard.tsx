import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStoreContextMenu } from '../../hooks/useStoreContextMenu';
import { useT } from '../../lib/i18n';
import { useIsInLibrary } from '../../lib/libraryMembership';
import type { SamCategory, SamGameCard } from '../../types/sam';
import { ContentTagPills } from './ContentTagPills';

interface Props {
  game: SamGameCard;
  category: SamCategory;
}

const SLIDE_MS = 1400;
/** Lets the pointer reach rail arrows without triggering pop-out. */
const HOVER_OPEN_MS = 200;

/** Rail card with Steam-style hover: pop-out, screenshot cycle, meta. */
export function RailGameCard({ game, category }: Props) {
  const { t } = useT();
  const { openStoreContextMenu } = useStoreContextMenu(category);
  const inLibrary = useIsInLibrary(game.threadId);
  const [hovered, setHovered] = useState(false);
  const [slide, setSlide] = useState(0);
  const openTimerRef = useRef<number | null>(null);

  const images = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (url: string | null | undefined) => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      out.push(url);
    };
    push(game.thumbnailUrl);
    for (const s of game.screens) push(s);
    return out;
  }, [game.thumbnailUrl, game.screens]);

  useEffect(() => {
    if (!hovered || images.length <= 1) {
      setSlide(0);
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => {
      setSlide((i) => (i + 1) % images.length);
    }, SLIDE_MS);
    return () => window.clearInterval(id);
  }, [hovered, images.length]);

  useEffect(() => {
    return () => {
      if (openTimerRef.current != null) {
        window.clearTimeout(openTimerRef.current);
      }
    };
  }, []);

  const clearOpenTimer = () => {
    if (openTimerRef.current != null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  };

  const onEnter = () => {
    clearOpenTimer();
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      setHovered(true);
    }, HOVER_OPEN_MS);
  };

  const onLeave = () => {
    clearOpenTimer();
    setHovered(false);
    setSlide(0);
  };

  const activeSrc = images[Math.min(slide, Math.max(images.length - 1, 0))] ?? null;

  return (
    <Link
      to={`/store/game/${game.threadId}?cat=${category}`}
      className={`rail-game-card${hovered ? ' is-hovered' : ''}`}
      onContextMenu={(e) => void openStoreContextMenu(e, game)}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
    >
      <div className="rail-game-card-thumb">
        {activeSrc ? (
          <img
            key={activeSrc}
            src={activeSrc}
            alt={game.title}
            loading="lazy"
            className="rail-game-card-img"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="rail-game-card-fallback">{game.title.slice(0, 1).toUpperCase()}</div>
        )}
        {inLibrary && (
          <div className="rail-game-card-library" title={t('store.badge.inLibrary')}>
            {t('store.badge.inLibrary')}
          </div>
        )}
        {game.version && <div className="rail-game-card-version">{game.version}</div>}
        {hovered && images.length > 1 && (
          <div className="rail-game-card-dots" aria-hidden>
            {images.map((src, i) => (
              <span
                key={src}
                className={`rail-game-card-dot${i === slide ? ' is-active' : ''}`}
              />
            ))}
          </div>
        )}
      </div>
      <div className="rail-game-card-body">
        <div className="rail-game-card-title" title={game.title}>
          {game.title}
        </div>
        <div className="rail-game-card-hover-meta">
          <div className="rail-game-card-hover-meta-inner">
            {(game.creator || game.rating !== null) && (
              <div className="rail-game-card-hover-row">
                {game.creator && (
                  <span className="rail-game-card-creator" title={game.creator}>
                    {game.creator}
                  </span>
                )}
                {game.rating !== null && (
                  <span className="rail-game-card-rating">
                    <span className="rail-game-card-rating-icon">★</span>
                    {game.rating.toFixed(1)}
                  </span>
                )}
              </div>
            )}
            <ContentTagPills tagIds={game.tagIds} max={3} />
          </div>
        </div>
      </div>
    </Link>
  );
}
