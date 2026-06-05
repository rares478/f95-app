import { useEffect, useRef } from 'react';
import { useT } from '../../lib/i18n';
import type { MediaViewItem } from '../../types/media';

interface Props {
  items: MediaViewItem[];
  activePath: string;
  onSelect: (item: MediaViewItem) => void;
}

export function VideoSidebar({ items, activePath, onSelect }: Props) {
  const { t } = useT();
  const activeRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activePath]);

  return (
    <div className="media-viewer-pages media-viewer-videos-list">
      <div className="media-viewer-pages-head">
        <span className="media-viewer-group-label">{t('mediaViewer.group.videos')}</span>
        <span className="media-viewer-pages-count">{items.length}</span>
      </div>
      <ul className="media-viewer-page-list">
        {items.map((item, idx) => {
          const active = item.path === activePath;
          return (
            <li key={item.path} ref={active ? activeRef : undefined}>
              <button
                type="button"
                className={`media-viewer-page-btn media-viewer-video-item${active ? ' media-viewer-page-btn--active' : ''}`}
                onClick={() => onSelect(item)}
                title={item.path}
              >
                <span className="media-viewer-video-icon" aria-hidden>
                  ▶
                </span>
                <span className="media-viewer-page-num">{idx + 1}</span>
                <span className="media-viewer-page-name">{item.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
