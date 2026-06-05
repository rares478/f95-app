import { useEffect, useRef } from 'react';

const DEFAULT_SCROLL_ROOT = '.app-main';

interface Options {
  /** Pixels from the top of the scroll container used as the active anchor. */
  anchorOffset?: number;
  /** Ignore spy updates briefly after programmatic scroll (e.g. nav click). */
  pauseMs?: number;
  /** Element id prefix — sections are `${prefix}${id}`. */
  idPrefix?: string;
  scrollRootSelector?: string;
}

/**
 * Highlights the nav item for whichever section is currently in view while the
 * user scrolls the main app column.
 */
export function useScrollSpy<T extends string>(
  sectionIds: readonly T[],
  onActive: (id: T) => void,
  options?: Options,
) {
  const pauseUntilRef = useRef(0);
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;

  const anchorOffset = options?.anchorOffset ?? 120;
  const pauseMs = options?.pauseMs ?? 700;
  const idPrefix = options?.idPrefix ?? '';
  const scrollRootSelector = options?.scrollRootSelector ?? DEFAULT_SCROLL_ROOT;

  const pause = () => {
    pauseUntilRef.current = Date.now() + pauseMs;
  };

  useEffect(() => {
    const scrollRoot = document.querySelector(scrollRootSelector);
    if (!scrollRoot || sectionIds.length === 0) return;

    function resolveActive(): T {
      const el = scrollRoot as HTMLElement;
      const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
      if (nearBottom) return sectionIds[sectionIds.length - 1];

      const anchor = el.getBoundingClientRect().top + anchorOffset;
      let current = sectionIds[0];
      for (const id of sectionIds) {
        const section = document.getElementById(`${idPrefix}${id}`);
        if (!section) continue;
        if (section.getBoundingClientRect().top <= anchor) current = id;
      }
      return current;
    }

    function update() {
      if (Date.now() < pauseUntilRef.current) return;
      onActiveRef.current(resolveActive());
    }

    scrollRoot.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();

    return () => {
      scrollRoot.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [sectionIds, anchorOffset, idPrefix, scrollRootSelector]);

  return { pauseScrollSpy: pause };
}
