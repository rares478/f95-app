import { useEffect, useMemo, useState } from 'react';
import { directAssetUrl, upgradeDisplayUrl } from '../../lib/mediaPreview';

type FitMode = 'contain' | 'width';

interface Props {
  path: string;
  alt: string;
  fitMode: FitMode;
  /** Tamanho em bytes do arquivo original; usado para decidir preview em background. */
  fileSize?: number;
}

export function ReaderImage({ path, alt, fitMode, fileSize }: Props) {
  const directUrl = useMemo(() => directAssetUrl(path), [path]);
  const [src, setSrc] = useState(directUrl);
  const [decoded, setDecoded] = useState(false);

  useEffect(() => {
    setSrc(directUrl);
    setDecoded(false);

    if (!fileSize) return;

    let cancelled = false;
    void upgradeDisplayUrl(path, fileSize).then((url) => {
      if (!cancelled && url !== directUrl) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [path, fileSize, directUrl]);

  return (
    <img
      className={`media-viewer-image media-viewer-image--${fitMode}${decoded ? ' media-viewer-image--ready' : ''}`}
      src={src}
      alt={alt}
      decoding="async"
      onLoad={() => setDecoded(true)}
    />
  );
}
