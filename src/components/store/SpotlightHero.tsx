import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useStoreContextMenu } from '../../hooks/useStoreContextMenu';
import { storeGameFullUrls, storeGameImageUrl } from '../../lib/f95ImageUrl';
import { useT } from '../../lib/i18n';
import { useIsInLibrary } from '../../lib/libraryMembership';
import {
  STORE_CARD_SLIDE_MS,
  nextStoreCardSlide,
  shouldAdvanceStoreCardSlide,
  storeCardActiveSrc,
} from '../../lib/storeCardHoverImages';
import type { SamCategory, SamGameCard } from '../../types/sam';
import { ContentTagPills } from './ContentTagPills';
import { PrefixPills } from './PrefixPills';
import { StoreCardThumbDots } from './StoreCardThumbDots';

interface Props {
  slides: SamGameCard[];
  category: SamCategory;
}

const AUTO_ADVANCE_MS = 6000;
/** Keep in sync with `.spotlight-slide--front.is-animate` duration. */
const FADE_MS = 900;

/**
 * Layout B spotlight: large active slide + “Up next” queue.
 * Front layer fades in via CSS animation on mount; back layer holds the
 * previous slide underneath until the fade finishes.
 */
export function SpotlightHero({ slides, category }: Props) {
  const { t } = useT();
  const { openStoreContextMenu } = useStoreContextMenu(category);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  const activeGame =
    slides.length > 0 ? slides[Math.min(active, slides.length - 1)]! : null;

  const [front, setFront] = useState<SamGameCard | null>(null);
  const [back, setBack] = useState<SamGameCard | null>(null);
  const [animateFront, setAnimateFront] = useState(false);
  const frontIdRef = useRef<string | null>(null);
  const backClearRef = useRef<number | null>(null);
  const slidesRef = useRef(slides);
  slidesRef.current = slides;

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

  useEffect(() => {
    if (!activeGame) {
      frontIdRef.current = null;
      setFront(null);
      setBack(null);
      setAnimateFront(false);
      return;
    }

    const nextId = activeGame.threadId;
    if (frontIdRef.current === nextId) {
      setFront(activeGame);
      return;
    }

    const prevId = frontIdRef.current;
    const previous =
      prevId != null
        ? slidesRef.current.find((s) => s.threadId === prevId) ?? null
        : null;

    if (backClearRef.current != null) {
      window.clearTimeout(backClearRef.current);
      backClearRef.current = null;
    }

    if (previous && previous.threadId !== nextId) {
      setBack(previous);
      setAnimateFront(true);
      backClearRef.current = window.setTimeout(() => {
        setBack(null);
        setAnimateFront(false);
        backClearRef.current = null;
      }, FADE_MS);
    } else {
      setBack(null);
      setAnimateFront(false);
    }

    frontIdRef.current = nextId;
    setFront(activeGame);
  }, [activeGame]);

  useEffect(() => {
    return () => {
      if (backClearRef.current != null) {
        window.clearTimeout(backClearRef.current);
      }
    };
  }, []);

  if (!activeGame || !front) return null;

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
        <div className="spotlight-stage">
          {back && (
            <SpotlightSlide
              key={`back-${back.threadId}`}
              game={back}
              detailTo={`/store/game/${back.threadId}?cat=${category}`}
              onContextMenu={(e) => void openStoreContextMenu(e, back)}
              layer="back"
              cycling={false}
            />
          )}
          <SpotlightSlide
            key={`front-${front.threadId}`}
            game={front}
            detailTo={`/store/game/${front.threadId}?cat=${category}`}
            onContextMenu={(e) => void openStoreContextMenu(e, front)}
            layer="front"
            animate={animateFront}
            cycling={paused}
          />
        </div>

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
          {slides.map((slide, i) => {
            const thumbSrc = storeGameImageUrl(slide, 'thumb');
            return (
            <button
              key={slide.threadId}
              type="button"
              className={`spotlight-up-next-item${i === active ? ' is-active' : ''}`}
              aria-current={i === active ? 'true' : undefined}
              onClick={() => setActive(i)}
            >
              <span className="spotlight-up-next-thumb">
                {thumbSrc ? (
                  <img src={thumbSrc} alt="" loading="lazy" />
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
            );
          })}
        </div>
      </aside>
    </section>
  );
}

function SpotlightSlide({
  game,
  detailTo,
  onContextMenu,
  layer,
  animate = false,
  cycling,
}: {
  game: SamGameCard;
  detailTo: string;
  onContextMenu: (e: MouseEvent) => void;
  layer: 'front' | 'back';
  animate?: boolean;
  cycling: boolean;
}) {
  const { t } = useT();
  const inLibrary = useIsInLibrary(game.threadId);
  const images = useMemo(
    () => storeGameFullUrls(game),
    [game.thumbnailUrl, game.screens],
  );
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (
      !shouldAdvanceStoreCardSlide({
        hovered: cycling,
        imageCount: images.length,
        prefersReducedMotion,
      })
    ) {
      setSlide(0);
      return;
    }
    const id = window.setInterval(() => {
      setSlide((i) => nextStoreCardSlide(i, images.length));
    }, STORE_CARD_SLIDE_MS);
    return () => window.clearInterval(id);
  }, [cycling, images.length]);

  const imageSrc = storeCardActiveSrc(images, slide);
  const className = [
    'spotlight-slide',
    `spotlight-slide--${layer}`,
    animate ? 'is-animate' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Link
      to={detailTo}
      className={className}
      onContextMenu={onContextMenu}
      tabIndex={layer === 'back' ? -1 : undefined}
      aria-hidden={layer === 'back' ? true : undefined}
    >
      {imageSrc ? (
        <img
          key={imageSrc}
          src={imageSrc}
          alt={game.title}
          className={`spotlight-slide-img${cycling ? ' store-card-thumb-img-anim' : ''}`}
          loading="eager"
          decoding="async"
        />
      ) : (
        <div className="spotlight-slide-fallback">{game.title.slice(0, 1).toUpperCase()}</div>
      )}
      <div className="spotlight-slide-overlay" />
      {cycling && <StoreCardThumbDots images={images} slide={slide} />}

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
      </div>
    </Link>
  );
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
