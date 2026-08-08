import { useEffect, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import { toF95ThumbUrl } from '../../lib/f95ImageUrl';
import { prefetchRemoteImage } from '../../lib/remoteImageQueue';
import { clampGalleryIndex } from '../../lib/screenshotGalleryIndex';
import { LazyRemoteImage } from './LazyRemoteImage';
import '../../styles/game-description.css';

interface Props {
  images: string[];
}

export function ScreenshotGallery({ images }: Props) {
  const { t } = useT();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    setSelectedIndex((i) => clampGalleryIndex(i, images.length));
    setOpenIndex((i) => (i === null ? null : clampGalleryIndex(i, images.length)));
  }, [images.length]);

  useEffect(() => {
    if (openIndex === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenIndex(null);
      if (e.key === 'ArrowRight') {
        setOpenIndex((i) => {
          if (i === null) return null;
          const next = clampGalleryIndex(i + 1, images.length);
          setSelectedIndex(next);
          return next;
        });
      }
      if (e.key === 'ArrowLeft') {
        setOpenIndex((i) => {
          if (i === null) return null;
          const next = clampGalleryIndex(i - 1, images.length);
          setSelectedIndex(next);
          return next;
        });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openIndex, images.length]);

  useEffect(() => {
    const idx = openIndex ?? selectedIndex;
    if (idx + 1 < images.length) prefetchRemoteImage(images[idx + 1], 0);
    if (idx > 0) prefetchRemoteImage(images[idx - 1], 1);
  }, [openIndex, selectedIndex, images]);

  useEffect(() => {
    const el = thumbRefs.current[selectedIndex];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, [selectedIndex]);

  if (images.length === 0) return null;

  const featuredSrc = images[selectedIndex];

  return (
    <>
      <div className="game-detail-screenshot-gallery">
        <button
          type="button"
          className="game-detail-screenshot-stage"
          onClick={() => setOpenIndex(selectedIndex)}
          aria-label={t('gamedetail.screenshot.open', { n: selectedIndex + 1 })}
        >
          <LazyRemoteImage
            src={featuredSrc}
            previewSrc={toF95ThumbUrl(featuredSrc)}
            upgrade="grid"
            className="game-detail-screenshot-img"
            rootMargin="80px 0px"
          />
        </button>

        {images.length > 1 && (
          <div className="game-detail-screenshot-strip" role="list">
            {images.map((src, i) => (
              <button
                key={`${i}-${src}`}
                type="button"
                role="listitem"
                ref={(el) => {
                  thumbRefs.current[i] = el;
                }}
                className={
                  i === selectedIndex
                    ? 'game-detail-screenshot-thumb game-detail-screenshot-thumb--active'
                    : 'game-detail-screenshot-thumb'
                }
                aria-current={i === selectedIndex ? 'true' : undefined}
                aria-label={t('gamedetail.screenshot.show', { n: i + 1 })}
                onClick={() => setSelectedIndex(i)}
              >
                <LazyRemoteImage
                  src={src}
                  previewSrc={toF95ThumbUrl(src)}
                  upgrade="grid"
                  className="game-detail-screenshot-img"
                  rootMargin="80px 0px"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {openIndex !== null && (
        <div
          role="dialog"
          aria-modal
          style={lightboxStyle}
          onClick={() => setOpenIndex(null)}
        >
          <img
            src={images[openIndex]}
            alt=""
            style={lightboxImgStyle}
            decoding="async"
            onClick={(e) => e.stopPropagation()}
          />
          <div style={lightboxCountStyle}>
            {openIndex + 1} / {images.length}
          </div>
          {openIndex > 0 && (
            <button
              type="button"
              style={{ ...lightboxNavStyle, left: 16 }}
              onClick={(e) => {
                e.stopPropagation();
                const next = clampGalleryIndex(openIndex - 1, images.length);
                setOpenIndex(next);
                setSelectedIndex(next);
              }}
              aria-label={t('gamedetail.screenshot.prev')}
            >
              ‹
            </button>
          )}
          {openIndex < images.length - 1 && (
            <button
              type="button"
              style={{ ...lightboxNavStyle, right: 16 }}
              onClick={(e) => {
                e.stopPropagation();
                const next = clampGalleryIndex(openIndex + 1, images.length);
                setOpenIndex(next);
                setSelectedIndex(next);
              }}
              aria-label={t('gamedetail.screenshot.next')}
            >
              ›
            </button>
          )}
        </div>
      )}
    </>
  );
}

const lightboxStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.92)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'zoom-out',
};

const lightboxImgStyle: React.CSSProperties = {
  maxWidth: '92vw',
  maxHeight: '92vh',
  objectFit: 'contain',
  cursor: 'default',
};

const lightboxCountStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 16,
  color: '#ddd',
  fontSize: 13,
  background: 'rgba(0,0,0,0.6)',
  padding: '4px 10px',
  borderRadius: 2,
};

const lightboxNavStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  background: 'rgba(0,0,0,0.55)',
  color: 'var(--text-primary)',
  border: 'none',
  width: 44,
  height: 56,
  borderRadius: 4,
  fontSize: 28,
  cursor: 'pointer',
};
