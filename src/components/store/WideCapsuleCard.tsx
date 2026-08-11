import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStoreContextMenu } from '../../hooks/useStoreContextMenu';
import { toF95FullUrl } from '../../lib/f95ImageUrl';
import { useT } from '../../lib/i18n';
import { useIsInLibrary } from '../../lib/libraryMembership';
import type { SamCategory, SamGameCard } from '../../types/sam';

interface Props {
  game: SamGameCard;
  category: SamCategory;
}

/** Lets the pointer reach rail arrows without triggering pop-out. */
const HOVER_OPEN_MS = 200;

function shortUpdatedAt(updatedAt: string | null): string | null {
  if (!updatedAt) return null;
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return updatedAt;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Landscape capsule card for discovery rails (no screenshot carousel). */
export function WideCapsuleCard({ game, category }: Props) {
  const { t } = useT();
  const { openStoreContextMenu } = useStoreContextMenu(category);
  const inLibrary = useIsInLibrary(game.threadId);
  const [hovered, setHovered] = useState(false);
  const openTimerRef = useRef<number | null>(null);

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
  };

  const meta = game.version || shortUpdatedAt(game.updatedAt);
  const imageSrc = game.thumbnailUrl ? toF95FullUrl(game.thumbnailUrl) : null;

  return (
    <Link
      to={`/store/game/${game.threadId}?cat=${category}`}
      className={`wide-capsule-card${hovered ? ' is-hovered' : ''}`}
      onContextMenu={(e) => void openStoreContextMenu(e, game)}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
    >
      <div className="wide-capsule-card-thumb">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={game.title}
            loading="lazy"
            decoding="async"
            className="wide-capsule-card-img"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="wide-capsule-card-fallback">{game.title.slice(0, 1).toUpperCase()}</div>
        )}
        {inLibrary && (
          <div className="wide-capsule-card-library" title={t('store.badge.inLibrary')}>
            {t('store.badge.inLibrary')}
          </div>
        )}
        <div className="wide-capsule-card-overlay">
          <div className="wide-capsule-card-title" title={game.title}>
            {game.title}
          </div>
          {meta && <div className="wide-capsule-card-meta">{meta}</div>}
        </div>
      </div>
    </Link>
  );
}
