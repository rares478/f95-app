import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { useElementWidth } from '../../hooks/useElementWidth';
import { useStoreCardHoverImages } from '../../hooks/useStoreCardHoverImages';
import { useStoreContextMenu } from '../../hooks/useStoreContextMenu';
import { useT } from '../../lib/i18n';
import { useIsInLibrary } from '../../lib/libraryMembership';
import type { SamCategory, SamGameCard } from '../../types/sam';
import { StoreCardThumbDots } from './StoreCardThumbDots';

interface Props {
  game: SamGameCard;
  category: SamCategory;
  /** True when this card sits under a rail chevron — stay dimmed, no hover pop. */
  underNav?: boolean;
}

function shortUpdatedAt(updatedAt: string | null): string | null {
  if (!updatedAt) return null;
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return updatedAt;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Landscape capsule card for discovery rails with hover screenshot cycle. */
export function WideCapsuleCard({ game, category, underNav = false }: Props) {
  const { t } = useT();
  const { openStoreContextMenu } = useStoreContextMenu(category);
  const inLibrary = useIsInLibrary(game.threadId);
  const cardRef = useRef<HTMLAnchorElement>(null);
  const widthPx = useElementWidth(cardRef);
  const { images, hovered, slide, activeSrc, onEnter, onLeave } =
    useStoreCardHoverImages(game, widthPx);

  const meta = game.version || shortUpdatedAt(game.updatedAt);
  const showHover = hovered && !underNav;

  return (
    <Link
      ref={cardRef}
      to={`/store/game/${game.threadId}?cat=${category}`}
      data-rail-card-id={game.threadId}
      className={`wide-capsule-card${showHover ? ' is-hovered' : ''}${underNav ? ' is-under-nav' : ''}`}
      tabIndex={underNav ? -1 : undefined}
      aria-disabled={underNav || undefined}
      onContextMenu={underNav ? (e) => e.preventDefault() : (e) => void openStoreContextMenu(e, game)}
      onMouseEnter={underNav ? undefined : onEnter}
      onMouseLeave={underNav ? undefined : onLeave}
      onFocus={underNav ? undefined : onEnter}
      onBlur={underNav ? undefined : onLeave}
      onClick={underNav ? (e) => e.preventDefault() : undefined}
    >
      <div className="wide-capsule-card-thumb">
        {activeSrc ? (
          <img
            key={activeSrc}
            src={activeSrc}
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
        {showHover && <StoreCardThumbDots images={images} slide={slide} />}
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
