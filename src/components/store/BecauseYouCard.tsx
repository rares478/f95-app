import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useStoreContextMenu } from '../../hooks/useStoreContextMenu';
import { storeGameFullUrls } from '../../lib/f95ImageUrl';
import { useT } from '../../lib/i18n';
import type { BecauseYouCardModel } from '../../types/becauseYou';
import type { SamCategory } from '../../types/sam';
import { ContentTagPills } from './ContentTagPills';

interface Props {
  card: BecauseYouCardModel;
  category: SamCategory;
}

export function BecauseYouCard({ card, category }: Props) {
  const { t } = useT();
  const { openStoreContextMenu } = useStoreContextMenu(category);
  const { game, reason } = card;

  const reasonText =
    reason.kind === 'play'
      ? t('store.home.becauseYou.reason.play', { title: reason.seedTitle })
      : t('store.home.becauseYou.reason.interest', { tag: reason.tagName });

  const { coverSrc, screenSrcs } = useMemo(() => {
    const urls = storeGameFullUrls(game);
    return {
      coverSrc: urls[0] ?? null,
      screenSrcs: urls.slice(1, 4),
    };
  }, [game.thumbnailUrl, game.screens]);

  return (
    <Link
      to={`/store/game/${game.threadId}?cat=${category}`}
      className="because-you-card"
      onContextMenu={(e) => void openStoreContextMenu(e, game)}
    >
      <header className="because-you-card-header">
        <h3 className="because-you-card-title">{game.title}</h3>
        <p className="because-you-card-reason">{reasonText}</p>
      </header>
      <div className="because-you-card-media">
        <div className="because-you-card-cover">
          {coverSrc ? (
            <img
              src={coverSrc}
              alt={game.title}
              loading="lazy"
              decoding="async"
              className="because-you-card-img"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="because-you-card-fallback">{game.title.slice(0, 1).toUpperCase()}</div>
          )}
        </div>
        <div className="because-you-card-grid">
          {screenSrcs.map((src) => (
            <div key={src} className="because-you-card-screen">
              <img
                src={src}
                alt=""
                loading="lazy"
                decoding="async"
                className="because-you-card-img"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
          ))}
          <div className="because-you-card-meta">
            <ContentTagPills tagIds={game.tagIds} max={6} />
            {game.creator && (
              <div className="because-you-card-creator" title={game.creator}>
                {game.creator}
              </div>
            )}
            {game.rating != null && (
              <div className="because-you-card-rating">★ {game.rating.toFixed(1)}</div>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
