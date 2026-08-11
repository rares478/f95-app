import { useEffect, useState } from 'react';
import { toF95FullUrl } from './f95ImageUrl';
import { requestLibraryPreview } from './libraryPreviewQueue';
import type { LibraryGame } from '../types/library';

/** Warm the on-disk cache for a library thumbnail (~720px JPEG, full-res source). */
export function prefetchLibraryThumbnail(url: string, priority = 3): void {
  void requestLibraryPreview(url, priority).catch(() => {});
}

/** Prefetch thumbnails for existing library rows (low priority, staggered). */
export function prefetchLibraryThumbnails(games: LibraryGame[]): void {
  games.forEach((game, index) => {
    if (game.thumbnailUrl) {
      prefetchLibraryThumbnail(game.thumbnailUrl, 6 + index);
    }
  });
}

/** Resolve a remote library image URL to a locally cached asset when available. */
export function useCachedImageUrl(
  url: string | null | undefined,
  priority = 2,
): string | null {
  const [displaySrc, setDisplaySrc] = useState<string | null>(() =>
    url ? toF95FullUrl(url) : null,
  );

  useEffect(() => {
    if (!url) {
      setDisplaySrc(null);
      return;
    }
    let cancelled = false;
    setDisplaySrc(toF95FullUrl(url));
    void requestLibraryPreview(url, priority).then((cached) => {
      if (!cancelled) setDisplaySrc(cached);
    });
    return () => {
      cancelled = true;
    };
  }, [url, priority]);

  return displaySrc;
}
