import { useSyncExternalStore } from 'react';
import {
  getSidebarThumbUrl,
  getSidebarThumbVersion,
  subscribeSidebarThumbs,
} from '../../lib/thumbQueue';
import '../../styles/media-viewer-thumbs.css';

interface Props {
  path: string;
}

export function PageThumb({ path }: Props) {
  useSyncExternalStore(subscribeSidebarThumbs, getSidebarThumbVersion, getSidebarThumbVersion);
  const url = getSidebarThumbUrl(path);

  return (
    <span
      className={`media-viewer-page-thumb${url ? ' media-viewer-page-thumb--loaded' : ' media-viewer-page-thumb--placeholder'}`}
      aria-hidden
    >
      {url ? <img src={url} alt="" decoding="async" loading="lazy" /> : null}
    </span>
  );
}
