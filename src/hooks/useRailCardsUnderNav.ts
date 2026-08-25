import { useCallback, useEffect, useState, type RefObject } from 'react';

const MIN_OVERLAP_PX = 14;

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

/**
 * Tracks which `[data-rail-card-id]` cards overlap visible rail nav buttons,
 * so edge cards can be dimmed while under the chevrons.
 */
export function useRailCardsUnderNav(
  scrollerRef: RefObject<HTMLElement | null>,
  trackRef: RefObject<HTMLElement | null>,
  /** Bump when track contents or nav enabled state change. */
  revision: string | number,
): Set<string> {
  const [underNav, setUnderNav] = useState(() => new Set<string>());

  const update = useCallback(() => {
    const scroller = scrollerRef.current;
    const track = trackRef.current;
    if (!scroller || !track) {
      setUnderNav((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }

    const navs = Array.from(
      scroller.querySelectorAll<HTMLElement>('.discovery-rail-nav:not(:disabled)'),
    );
    if (navs.length === 0) {
      setUnderNav((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }

    const navRects = navs.map((n) => n.getBoundingClientRect());
    const next = new Set<string>();

    for (const card of track.querySelectorAll<HTMLElement>('[data-rail-card-id]')) {
      const id = card.dataset.railCardId;
      if (!id) continue;
      const r = card.getBoundingClientRect();
      for (const nr of navRects) {
        const overlapX = Math.min(r.right, nr.right) - Math.max(r.left, nr.left);
        const overlapY = Math.min(r.bottom, nr.bottom) - Math.max(r.top, nr.top);
        if (overlapX >= MIN_OVERLAP_PX && overlapY >= MIN_OVERLAP_PX) {
          next.add(id);
          break;
        }
      }
    }

    setUnderNav((prev) => (setsEqual(prev, next) ? prev : next));
  }, [scrollerRef, trackRef]);

  useEffect(() => {
    const track = trackRef.current;
    const scroller = scrollerRef.current;
    if (!track || !scroller) return;

    update();
    track.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(track);
    ro?.observe(scroller);
    return () => {
      track.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, [scrollerRef, trackRef, revision, update]);

  return underNav;
}
