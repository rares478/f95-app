import { Link } from 'react-router-dom';
import { useStoreContextMenu } from '../../hooks/useStoreContextMenu';
import { useT } from '../../lib/i18n';
import { useIsInLibrary } from '../../lib/libraryMembership';
import type { SamCategory, SamGameCard } from '../../types/sam';

interface Props {
  game: SamGameCard;
  category: SamCategory;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Wide cover tile for Steam-style tag panels (rating or likes footer). */
export function TagPanelTile({ game, category }: Props) {
  const { t } = useT();
  const { openStoreContextMenu } = useStoreContextMenu(category);
  const inLibrary = useIsInLibrary(game.threadId);

  const footer =
    game.rating != null
      ? { kind: 'rating' as const, text: game.rating.toFixed(1) }
      : game.likes != null
        ? { kind: 'likes' as const, text: formatCount(game.likes) }
        : null;

  return (
    <Link
      to={`/store/game/${game.threadId}?cat=${category}`}
      className="tag-panel-tile"
      onContextMenu={(e) => void openStoreContextMenu(e, game)}
    >
      <div className="tag-panel-tile-thumb">
        {game.thumbnailUrl ? (
          <img
            src={game.thumbnailUrl}
            alt={game.title}
            loading="lazy"
            className="tag-panel-tile-img"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="tag-panel-tile-fallback">{game.title.slice(0, 1).toUpperCase()}</div>
        )}
        {inLibrary && (
          <div className="tag-panel-tile-library" title={t('store.badge.inLibrary')}>
            {t('store.badge.inLibrary')}
          </div>
        )}
      </div>
      <div className="tag-panel-tile-body">
        <div className="tag-panel-tile-title" title={game.title}>
          {game.title}
        </div>
        {footer && (
          <div className="tag-panel-tile-footer">
            {footer.kind === 'rating' ? (
              <>
                <span className="tag-panel-tile-footer-icon" aria-hidden>
                  ★
                </span>
                {footer.text}
              </>
            ) : (
              <>
                <span className="tag-panel-tile-footer-icon" aria-hidden>
                  ♥
                </span>
                {footer.text}
              </>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}
