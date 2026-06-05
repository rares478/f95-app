import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import { scheduleSidebarThumbs, type ThumbJob } from '../../lib/thumbQueue';
import type { MediaViewItem } from '../../types/media';
import { PageThumb } from './PageThumb';

const ROW_HEIGHT = 68;
const OVERSCAN = 8;

interface Props {
  items: MediaViewItem[];
  activePath: string;
  onSelect: (item: MediaViewItem) => void;
}

function thumbPriority(index: number, activeIndex: number): number {
  if (activeIndex < 0) return 5;
  const dist = Math.abs(index - activeIndex);
  if (dist === 0) return 0;
  if (dist <= 3) return 1;
  if (dist <= 8) return 2;
  return 5;
}

export function PageSidebar({ items, activePath, onSelect }: Props) {
  const { t } = useT();
  const listRef = useRef<HTMLUListElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);
  const [range, setRange] = useState({ start: 0, end: Math.min(items.length, 40) });

  const activeIndex = items.findIndex((i) => i.path === activePath);

  const updateRange = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    const height = el.clientHeight || 400;
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(items.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [items.length]);

  useEffect(() => {
    updateRange();
    const el = listRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateRange, { passive: true });
    const ro = new ResizeObserver(updateRange);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateRange);
      ro.disconnect();
    };
  }, [updateRange]);

  useEffect(() => {
    setRange({ start: 0, end: Math.min(items.length, 40) });
    updateRange();
  }, [items.length, updateRange]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activePath]);

  useEffect(() => {
    const jobs: ThumbJob[] = [];
    for (let i = range.start; i < range.end; i++) {
      const item = items[i];
      if (!item || item.kind !== 'image') continue;
      jobs.push({
        path: item.path,
        size: item.size,
        priority: thumbPriority(i, activeIndex),
      });
    }
    scheduleSidebarThumbs(jobs);
  }, [range.start, range.end, items, activeIndex]);

  const topPad = range.start * ROW_HEIGHT;
  const bottomPad = Math.max(0, (items.length - range.end) * ROW_HEIGHT);

  return (
    <div className="media-viewer-pages">
      <div className="media-viewer-pages-head">
        <span className="media-viewer-group-label">{t('mediaViewer.group.images')}</span>
        <span className="media-viewer-pages-count">{items.length}</span>
      </div>
      <ul ref={listRef} className="media-viewer-page-list">
        {topPad > 0 && (
          <li className="media-viewer-page-spacer" style={{ height: topPad }} aria-hidden />
        )}
        {items.slice(range.start, range.end).map((item, offset) => {
          const idx = range.start + offset;
          const active = item.path === activePath;
          return (
            <li key={item.path} ref={active ? activeRef : undefined}>
              <button
                type="button"
                className={`media-viewer-page-btn${active ? ' media-viewer-page-btn--active' : ''}`}
                onClick={() => onSelect(item)}
                title={item.name}
              >
                <PageThumb path={item.path} />
                <span className="media-viewer-page-num">{idx + 1}</span>
                <span className="media-viewer-page-name">{item.name}</span>
              </button>
            </li>
          );
        })}
        {bottomPad > 0 && (
          <li className="media-viewer-page-spacer" style={{ height: bottomPad }} aria-hidden />
        )}
      </ul>
    </div>
  );
}
