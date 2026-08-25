import { useState } from 'react';
import type { PostAttachment } from '../types/threadPosts';
import { useOffline } from '../contexts/Offline';
import { useT } from '../lib/i18n';
import * as ipc from '../lib/ipc';
import { formatIpcError } from '../lib/ipcError';
import { dialog } from '../lib/dialog';
import { formatBytes } from '../types/download';

type RowStatus = 'idle' | 'working' | 'done' | 'error';

interface Props {
  attachments: PostAttachment[];
}

export function PostAttachments({ attachments }: Props) {
  const { t } = useT();
  const { isOffline } = useOffline();
  const files = attachments.filter((a) => !a.isImage);
  const [statusById, setStatusById] = useState<Record<string, RowStatus>>({});
  const [savedPathById, setSavedPathById] = useState<Record<string, string>>({});

  if (files.length === 0) return null;

  async function onDownload(file: PostAttachment) {
    if (isOffline) {
      await dialog.alert(t('attachments.offline'), { kind: 'info' });
      return;
    }
    setStatusById((prev) => ({ ...prev, [file.id]: 'working' }));
    try {
      const result = await ipc.downloadPostAttachment({
        url: file.url,
        fileName: file.fileName,
      });
      setSavedPathById((prev) => ({ ...prev, [file.id]: result.path }));
      setStatusById((prev) => ({ ...prev, [file.id]: 'done' }));
    } catch (err) {
      setStatusById((prev) => ({ ...prev, [file.id]: 'error' }));
      await dialog.alert(t('attachments.failed', { error: formatIpcError(err) }), {
        kind: 'error',
      });
    }
  }

  return (
    <section className="post-attachments" aria-label={t('attachments.title')}>
      <h3 className="post-attachments-title">{t('attachments.title')}</h3>
      {isOffline ? (
        <p className="post-attachments-offline">{t('attachments.offline')}</p>
      ) : null}
      <ul className="post-attachments-list">
        {files.map((file) => {
          const status = statusById[file.id] ?? 'idle';
          const busy = status === 'working';
          const savedPath = savedPathById[file.id];
          let label = t('attachments.download');
          if (status === 'working') label = t('attachments.downloading');
          else if (status === 'done') label = t('attachments.downloaded');

          return (
            <li key={file.id} className="post-attachments-row">
              <div className="post-attachments-meta">
                <span className="post-attachments-name" title={file.fileName}>
                  {file.fileName}
                </span>
                {file.fileSize != null ? (
                  <span className="post-attachments-size">{formatBytes(file.fileSize)}</span>
                ) : null}
              </div>
              <button
                type="button"
                className="post-attachments-btn"
                disabled={isOffline || busy}
                title={
                  isOffline
                    ? t('attachments.offline')
                    : status === 'done' && savedPath
                      ? savedPath
                      : undefined
                }
                onClick={() => void onDownload(file)}
              >
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
