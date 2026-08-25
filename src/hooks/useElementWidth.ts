import { useLayoutEffect, useState, type RefObject } from 'react';

/** Tracks border-box width of `ref`'s element via getBoundingClientRect. Returns 0 until measured. */
export function useElementWidth<T extends HTMLElement>(
  ref: RefObject<T | null>,
): number {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => setWidth(el.getBoundingClientRect().width);
    update();

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return width;
}
