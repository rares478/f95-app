import { useEffect, useRef, useState } from 'react';
import { requestGridPreview } from '../../lib/gridPreviewQueue';
import { instantPreviewUrl, toF95ThumbUrl } from '../../lib/f95ImageUrl';
import { requestRemoteImage } from '../../lib/remoteImageQueue';

export type LazyRemoteUpgrade = 'none' | 'grid' | 'full';

interface Props {
  src: string;
  previewSrc?: string;
  /** none = light preview only; grid = ~720px cache; full = original URL */
  upgrade?: LazyRemoteUpgrade;
  priority?: number;
  alt?: string;
  className?: string;
  rootMargin?: string;
}

export function LazyRemoteImage({
  src,
  previewSrc,
  upgrade = 'none',
  priority = 5,
  alt = '',
  className,
  rootMargin = '80px 0px',
}: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const preview = previewSrc ?? instantPreviewUrl(src) ?? toF95ThumbUrl(src);

  useEffect(() => {
    setDisplaySrc(null);
    const el = ref.current;
    if (!el) return;

    let cancelled = false;

    const startLoad = () => {
      if (cancelled) return;
      if (preview) setDisplaySrc(preview);

      if (upgrade === 'none') return;

      if (upgrade === 'grid') {
        void requestGridPreview(src, priority).then((url) => {
          if (!cancelled) setDisplaySrc(url);
        });
        return;
      }

      void requestRemoteImage(src, priority).then((url) => {
        if (!cancelled) setDisplaySrc(url);
      });
    };

    if (typeof IntersectionObserver === 'undefined') {
      startLoad();
      return () => {
        cancelled = true;
      };
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          startLoad();
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [src, preview, upgrade, priority, rootMargin]);

  const imgClass = className
    ? displaySrc
      ? className
      : `${className} ${className}--placeholder`
    : undefined;

  return (
    <span ref={ref} className="lazy-remote-image">
      {displaySrc ? (
        <img
          src={displaySrc}
          alt={alt}
          className={imgClass}
          decoding="async"
          loading="lazy"
        />
      ) : (
        <span className={imgClass ?? 'lazy-remote-image__placeholder'} aria-hidden />
      )}
    </span>
  );
}
