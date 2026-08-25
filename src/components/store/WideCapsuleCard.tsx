import { Link } from 'react-router-dom';
import { useStoreCardHoverImages } from '../../hooks/useStoreCardHoverImages';
import { useStoreContextMenu } from '../../hooks/useStoreContextMenu';
import { useT } from '../../lib/i18n';
import { useIsInLibrary } from '../../lib/libraryMembership';
import type { SamCategory, SamGameCard } from '../../types/sam';
import { StoreCardThumbDots } from './StoreCardThumbDots';

interface Props {
  game: SamGameCard;
  category: SamCategory;
}

function shortUpdatedAt(updatedAt: string | null): string | null {
  if (!updatedAt) return null;
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return updatedAt;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Landscape capsule card for discovery rails with hover screenshot cycle. */
export function WideCapsuleCard({ game, category }: Props) {
  const { t } = useT();
  const { openStoreContextMenu } = useStoreContextMenu(category);
  const inLibrary = useIsInLibrary(game.threadId);
  const { images, hovered, slide, activeSrc, onEnter, onLeave } =
    useStoreCardHoverImages(game);

  const meta = game.version || shortUpdatedAt(game.updatedAt);

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
        {hovered && <StoreCardThumbDots images={images} slide={slide} />}
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
