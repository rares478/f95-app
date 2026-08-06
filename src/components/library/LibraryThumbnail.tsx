import { useEffect, useRef, useState } from 'react';
import { toF95FullUrl } from '../../lib/f95ImageUrl';
import { requestLibraryPreview } from '../../lib/libraryPreviewQueue';

interface Props {
  src: string | null | undefined;
  alt?: string;
  style?: React.CSSProperties;
  className?: string;
  /** Lower = higher priority in the download queue. */
  priority?: number;
  /** Skip intersection observer — load immediately. */
  eager?: boolean;
  fallback?: React.ReactNode;
  rootMargin?: string;
}

export function LibraryThumbnail({
  src,
  alt = '',
  style,
  className,
  priority = 5,
  eager = false,
  fallback = null,
  rootMargin = '120px 0px',
}: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const [started, setStarted] = useState(eager);

  useEffect(() => {
    setDisplaySrc(null);
    setStarted(eager);
  }, [src, eager]);

  useEffect(() => {
    if (!started || !src) return;

    let cancelled = false;
    setDisplaySrc(toF95FullUrl(src));

    void requestLibraryPreview(src, priority).then((cached) => {
      if (!cancelled) setDisplaySrc(cached);
    });

    return () => {
      cancelled = true;
    };
  }, [started, src, priority]);

  useEffect(() => {
    if (eager || !src) return;
    const el = ref.current;
    if (!el) return;

    if (typeof IntersectionObserver === 'undefined') {
      setStarted(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setStarted(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [eager, rootMargin, src]);

  if (!src) return <>{fallback}</>;

  if (!displaySrc) {
    return (
      <span ref={ref} style={style} className={className} aria-hidden>
        {fallback}
      </span>
    );
  }

  return (
    <span ref={ref} style={{ display: 'contents' }}>
      <img
        src={displaySrc}
        alt={alt}
        style={style}
        className={className}
        decoding="async"
        loading={eager ? 'eager' : 'lazy'}
        draggable={false}
      />
    </span>
  );
}
