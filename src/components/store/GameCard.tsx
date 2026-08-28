import { Link } from 'react-router-dom';
import { useStoreCardHoverImages } from '../../hooks/useStoreCardHoverImages';
import { useStoreContextMenu } from '../../hooks/useStoreContextMenu';
import { useT } from '../../lib/i18n';
import { useIsInLibrary } from '../../lib/libraryMembership';
import type { SamCategory, SamGameCard } from '../../types/sam';
import { ContentTagPills } from './ContentTagPills';
import { DeveloperNameLink } from '../developer/DeveloperNameLink';
import { PrefixPills } from './PrefixPills';
import { StoreCardThumbDots } from './StoreCardThumbDots';

interface Props {
  game: SamGameCard;
  category: SamCategory;
}

export function GameCard({ game, category }: Props) {
  const { t } = useT();
  const { openStoreContextMenu } = useStoreContextMenu(category);
  const inLibrary = useIsInLibrary(game.threadId);
  const { images, hovered, slide, activeSrc, onEnter, onLeave } =
    useStoreCardHoverImages(game);

  return (
    <Link
      to={`/store/game/${game.threadId}?cat=${category}`}
      style={cardStyle}
      className={`store-card${hovered ? ' is-hovered' : ''}`}
      onContextMenu={(e) => void openStoreContextMenu(e, game)}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
    >
      <div style={thumbWrap}>
        {activeSrc ? (
          <img
            key={activeSrc}
            src={activeSrc}
            alt={game.title}
            loading="lazy"
            style={thumbImg}
            className="store-card-thumb-img-anim"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div style={thumbFallback}>{game.title.slice(0, 1).toUpperCase()}</div>
        )}
        {inLibrary && (
          <div style={libraryBadge} title={t('store.badge.inLibrary')}>
            {t('store.badge.inLibrary')}
          </div>
        )}
        {game.version && (
          <div className="store-card-version" style={versionBadge}>
            {game.version}
          </div>
        )}
        {hovered && <StoreCardThumbDots images={images} slide={slide} />}
      </div>

      <div style={bodyStyle}>
        <div style={titleStyle} title={game.title} className="store-card-title">
          {game.title}
        </div>

        {game.creator && (
          <DeveloperNameLink
            name={game.creator}
            className="store-card-creator-link"
            stopPropagation
          />
        )}

        <PrefixPills prefixIds={game.prefixIds} threadId={game.threadId} />
        <ContentTagPills tagIds={game.tagIds} />

        <div style={metaRow}>
          {game.rating !== null && <Meta label="★" value={game.rating.toFixed(1)} />}
          {game.likes !== null && <Meta label="♥" value={formatCount(game.likes)} />}
          {game.views !== null && <Meta label="👁" value={formatCount(game.views)} />}
        </div>
      </div>
    </Link>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span style={metaItem}>
      <span style={metaLabel}>{label}</span>
      <span>{value}</span>
    </span>
  );
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  overflow: 'hidden',
  textDecoration: 'none',
  color: 'var(--text-secondary)',
  transition: 'transform 0.12s, border-color 0.12s',
};

// See note in LibraryCard: padding-top reserves the 16:9 box BEFORE the
// image loads, so portrait thumbnails from F95 don't stretch the card.
const thumbWrap: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  paddingTop: '56.25%', // 9 / 16
  background: 'var(--bg-sunken)',
  overflow: 'hidden',
};

const thumbImg: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const thumbFallback: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 32,
  color: 'var(--text-faint)',
  fontWeight: 800,
};

const versionBadge: React.CSSProperties = {
  position: 'absolute',
  right: 6,
  /* bottom: idle 6px / hovered 18px via .store-card-version CSS */
  background: 'rgba(0, 0, 0, 0.75)',
  color: 'var(--text-primary)',
  padding: '2px 8px',
  borderRadius: 3,
  fontSize: 11,
  fontWeight: 600,
};

const libraryBadge: React.CSSProperties = {
  position: 'absolute',
  top: 6,
  right: 6,
  background: 'var(--status-success)',
  color: 'var(--text-primary)',
  padding: '2px 8px',
  borderRadius: 2,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.3,
};

const bodyStyle: React.CSSProperties = {
  padding: '10px 12px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const titleStyle: React.CSSProperties = {
  color: 'var(--text-primary)',
  fontSize: 14,
  fontWeight: 600,
  lineHeight: 1.3,
  overflow: 'hidden',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  minHeight: 36,
};

const metaRow: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  marginTop: 4,
  fontSize: 11,
  color: 'var(--text-muted)',
};

const metaItem: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
};

const metaLabel: React.CSSProperties = {
  color: 'var(--text-faint)',
};
