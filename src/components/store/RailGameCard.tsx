import { Link } from 'react-router-dom';
import { useStoreCardHoverImages } from '../../hooks/useStoreCardHoverImages';
import { useStoreContextMenu } from '../../hooks/useStoreContextMenu';
import { useT } from '../../lib/i18n';
import { useIsInLibrary } from '../../lib/libraryMembership';
import type { SamCategory, SamGameCard } from '../../types/sam';
import { ContentTagPills } from './ContentTagPills';
import { StoreCardThumbDots } from './StoreCardThumbDots';

interface Props {
  game: SamGameCard;
  category: SamCategory;
}

/** Rail card with Steam-style hover: pop-out, screenshot cycle, meta. */
export function RailGameCard({ game, category }: Props) {
  const { t } = useT();
  const { openStoreContextMenu } = useStoreContextMenu(category);
  const inLibrary = useIsInLibrary(game.threadId);
  const { images, hovered, slide, activeSrc, onEnter, onLeave } =
    useStoreCardHoverImages(game);

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
        {hovered && <StoreCardThumbDots images={images} slide={slide} />}
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
