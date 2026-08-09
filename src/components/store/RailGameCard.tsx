import { Link } from 'react-router-dom';
import { useStoreContextMenu } from '../../hooks/useStoreContextMenu';
import { useT } from '../../lib/i18n';
import { useIsInLibrary } from '../../lib/libraryMembership';
import type { SamCategory, SamGameCard } from '../../types/sam';

interface Props {
  game: SamGameCard;
  category: SamCategory;
}

/** Compact card for discovery rails — thumb + title, no dense tag rows. */
export function RailGameCard({ game, category }: Props) {
  const { t } = useT();
  const { openStoreContextMenu } = useStoreContextMenu(category);
  const inLibrary = useIsInLibrary(game.threadId);

  return (
    <Link
      to={`/store/game/${game.threadId}?cat=${category}`}
      className="rail-game-card"
      onContextMenu={(e) => void openStoreContextMenu(e, game)}
    >
      <div className="rail-game-card-thumb">
        {game.thumbnailUrl ? (
          <img
            src={game.thumbnailUrl}
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
      </div>
      <div className="rail-game-card-body">
        <div className="rail-game-card-title" title={game.title}>
          {game.title}
        </div>
      </div>
    </Link>
  );
}
