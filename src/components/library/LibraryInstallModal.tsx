import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { GameDownload } from '../../types/game';
import type { LibraryGame } from '../../types/library';
import type { InstallLibraryWithDisk } from '../../types/install-library';
import * as downloads from '../../lib/downloads';
import * as library from '../../lib/library';
import * as libraries from '../../lib/libraries';
import * as ipc from '../../lib/ipc';
import { groupDownloads } from '../../lib/groupDownloads';
import {
  HOST_COLORS,
  shouldShowHostBadge,
  STREAMABLE_HOSTS,
} from '../../lib/downloadHosts';
import { useOffline } from '../../contexts/Offline';
import { useT } from '../../lib/i18n';
import { formatIpcError } from '../../lib/ipcError';
import { dialog } from '../../lib/dialog';
import { InstallLocationModal } from '../InstallLocationModal';

export interface LibraryInstallModalProps {
  open: boolean;
  game: LibraryGame;
  links: GameDownload[];
  /** Version to stamp on the download row (available or current / links stamp). */
  gameVersion: string | null;
  onClose: () => void;
  onStarted?: () => void;
  /** When opened as “Browse all links” from the install plan wizard. */
  onBackToPlan?: () => void;
}

export function LibraryInstallModal({
  open,
  game,
  links,
  gameVersion,
  onClose,
  onStarted,
  onBackToPlan,
}: LibraryInstallModalProps) {
  const { t } = useT();
  const { isOffline } = useOffline();
  const [busyUrl, setBusyUrl] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<GameDownload | null>(null);

  if (!open) return null;

  const groups = groupDownloads(links);
  const title =
    game.installStatus === 'update_available'
      ? t('library.install.modalTitleUpdate', { title: game.title })
      : t('library.install.modalTitle', { title: game.title });

  async function startDownload(download: GameDownload, libraryPath?: string) {
    if (isOffline) {
      await dialog.alert(t('offline.actionBlocked'), { kind: 'info' });
      return;
    }
    setBusyUrl(download.url);
    try {
      await library.setStatus(game.threadId, 'downloading');
      const row = await downloads.create({
        threadId: game.threadId,
        host: download.host,
        sourceUrl: download.url,
        gameVersion,
      });
      await ipc.downloadStart({
        id: row.id,
        sourceUrl: row.sourceUrl,
        threadId: row.threadId,
        libraryPath,
        platformGroup: download.group,
      });
      onStarted?.();
      onClose();
    } catch (err) {
      await dialog.alert(t('dl.start.failed', { error: formatIpcError(err) }), { kind: 'error' });
    } finally {
      setBusyUrl(null);
    }
  }

  async function onDownloadClick(download: GameDownload) {
    await libraries.ensureSeeded();
    const libs = await libraries.listWithDisk();
    if (libs.length <= 1) {
      const lib = await libraries.getDefault();
      await startDownload(download, lib?.path);
      return;
    }
    setPending(download);
    setPickerOpen(true);
  }

  async function onLibraryPicked(lib: InstallLibraryWithDisk) {
    setPickerOpen(false);
    if (!pending) return;
    const dl = pending;
    setPending(null);
    await startDownload(dl, lib.path);
  }

  return createPortal(
    <>
      <div style={overlayStyle} onClick={onClose}>
        <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
          <h2 style={titleStyle}>{title}</h2>

          {links.length === 0 ? (
            <p className="dl-meta-text">{t('dl.empty')}</p>
          ) : (
            groups.map(([label, groupItems]) => (
              <div key={label ?? 'default'} style={{ marginBottom: 12 }}>
                {label && (
                  <div className="dl-meta-text" style={{ marginBottom: 6, fontWeight: 600 }}>
                    {label}
                  </div>
                )}
                <ul className="dl-item-list">
                  {groupItems.map((download) => {
                    const streamable = STREAMABLE_HOSTS.has(download.host);
                    const color = HOST_COLORS[download.host] ?? 'var(--text-muted)';
                    const labelText = download.text?.trim() || download.host;
                    const showHost = shouldShowHostBadge(labelText, download.host);
                    const rowKey = `${download.group ?? ''}\0${download.url}`;
                    return (
                      <li
                        key={rowKey}
                        className={`dl-item-row${showHost ? ' dl-item-row--with-host' : ''}`}
                      >
                        <span
                          className="dl-item-dot"
                          style={{ background: color }}
                          aria-hidden
                        />
                        <span className="dl-item-label" title={labelText}>
                          {labelText}
                        </span>
                        {showHost && (
                          <span className="dl-item-host">{download.host}</span>
                        )}
                        <button
                          type="button"
                          className="dl-action-btn dl-action-btn-accent dl-item-action"
                          disabled={busyUrl === download.url}
                          title={
                            streamable
                              ? t('dl.btn.tooltipSupported', { host: download.host })
                              : t('dl.btn.tooltipUnsupported', { host: download.host })
                          }
                          onClick={() => onDownloadClick(download)}
                        >
                          {busyUrl === download.url
                            ? '…'
                            : streamable
                              ? t('dl.btn.download')
                              : t('dl.btn.queue')}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}

          <div style={footerStyle}>
            {onBackToPlan && (
              <button type="button" style={cancelBtnStyle} onClick={onBackToPlan}>
                {t('common.back')}
              </button>
            )}
            <button type="button" style={cancelBtnStyle} onClick={onClose}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </div>

      <InstallLocationModal
        open={pickerOpen}
        title={t('modal.install.title', { game: game.title })}
        description={t('modal.install.hint')}
        primaryLabel={t('modal.install.confirm')}
        onCancel={() => {
          setPickerOpen(false);
          setPending(null);
        }}
        onConfirm={onLibraryPicked}
      />
    </>,
    document.body,
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.65)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 2000,
};

const modalStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '20px 22px',
  width: 'min(540px, calc(100vw - 40px))',
  maxHeight: 'calc(100vh - 80px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
  overflow: 'auto',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 17,
  fontWeight: 700,
  color: 'var(--text-primary)',
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 6,
};

const cancelBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--text-tertiary)',
  border: '1px solid var(--border-strong)',
  padding: '6px 14px',
  borderRadius: 3,
  fontSize: 13,
  cursor: 'pointer',
};
