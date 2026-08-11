import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { GameDownload } from '../../types/game';
import * as downloads from '../../lib/downloads';
import * as library from '../../lib/library';
import * as libraries from '../../lib/libraries';
import * as ipc from '../../lib/ipc';
import { saveLinksSnapshot } from '../../lib/libraryDownloadLinks';
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
import { InstallPlanWizard } from '../library/InstallPlanWizard';
import type { InstallLibraryWithDisk } from '../../types/install-library';
import type { SamCategory } from '../../types/sam';
import '../../styles/install-plan.css';

export interface DownloadLinksGameInfo {
  threadId: string;
  category?: SamCategory;
  title: string;
  threadUrl: string;
  thumbnailUrl: string | null;
  version: string | null;
}

interface Props {
  game: DownloadLinksGameInfo;
  downloads: GameDownload[];
  embedded?: boolean;
  /** Called after a wizard/download start succeeds (e.g. refresh library UI). */
  onStarted?: () => void;
}

export function DownloadLinks({
  game,
  downloads: items,
  embedded,
  onStarted,
}: Props) {
  const { t } = useT();
  const { isOffline } = useOffline();
  const [busyUrl, setBusyUrl] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<GameDownload | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);

  const groups = groupDownloads(items);

  async function prepareWizardStart() {
    await library.add({
      threadId: game.threadId,
      category: game.category,
      title: game.title,
      threadUrl: game.threadUrl,
      thumbnailUrl: game.thumbnailUrl,
      currentVersion: game.version,
    });
    try {
      await saveLinksSnapshot(game.threadId, items, game.version);
    } catch (err) {
      console.warn('[library] failed to cache download links on install start', err);
    }
  }

  async function startDownload(download: GameDownload, libraryPath?: string) {
    if (isOffline) {
      await dialog.alert(t('offline.actionBlocked'), { kind: 'info' });
      return;
    }
    setBusyUrl(download.url);
    try {
      await library.add({
        threadId: game.threadId,
        category: game.category,
        title: game.title,
        threadUrl: game.threadUrl,
        thumbnailUrl: game.thumbnailUrl,
        currentVersion: game.version,
      });
      await library.setStatus(game.threadId, 'downloading');
      try {
        await saveLinksSnapshot(game.threadId, items, game.version);
      } catch (err) {
        console.warn('[library] failed to cache download links on download start', err);
      }
      const row = await downloads.create({
        threadId: game.threadId,
        host: download.host,
        sourceUrl: download.url,
        gameVersion: game.version,
      });
      await ipc.downloadStart({
        id: row.id,
        sourceUrl: row.sourceUrl,
        threadId: row.threadId,
        libraryPath,
        platformGroup: download.group,
      });
      onStarted?.();
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
      await startDownload(download, libs[0]?.path);
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

  if (items.length === 0) {
    return <p className="dl-meta-text">{t('dl.empty')}</p>;
  }

  const linksBody = (
    <>
      {groups.map(([label, groupItems]) => (
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
                    onClick={() => void onDownloadClick(download)}
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
      ))}
    </>
  );

  return (
    <>
      {!embedded && <h3>{t('dl.section')}</h3>}

      {items.length > 0 && (
        <div className="install-wizard-store-actions">
          <button
            type="button"
            className="dl-action-btn dl-action-btn-accent"
            onClick={() => setWizardOpen(true)}
          >
            {t('libcard.cta.install')}
          </button>
          <button
            type="button"
            className="dl-action-btn"
            onClick={() => setLinksOpen(true)}
          >
            {t('dl.showAllLinks')}
          </button>
        </div>
      )}

      <InstallPlanWizard
        open={wizardOpen}
        threadId={game.threadId}
        title={game.title}
        links={items}
        gameVersion={game.version}
        intent="install"
        onClose={() => setWizardOpen(false)}
        onStarted={onStarted}
        prepareStart={prepareWizardStart}
      />

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

      {linksOpen && (
        <AllLinksModal
          title={game.title}
          closeLabel={t('common.cancel')}
          onClose={() => setLinksOpen(false)}
        >
          {linksBody}
        </AllLinksModal>
      )}
    </>
  );
}

function AllLinksModal({
  title,
  children,
  closeLabel,
  onClose,
}: {
  title: string;
  children: ReactNode;
  closeLabel: string;
  onClose: () => void;
}) {
  return createPortal(
    <div style={overlayStyle} onClick={onClose}>
      <div
        style={modalStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} links`}
      >
        <h2 style={titleStyle}>{title}</h2>
        <div style={bodyStyle}>{children}</div>
        <div style={footerStyle}>
          <button type="button" className="dl-action-btn" onClick={onClose}>{closeLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.65)',
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
  width: 'min(920px, calc(100vw - 40px))',
  maxHeight: 'calc(100vh - 80px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 17,
  fontWeight: 700,
  color: 'var(--text-primary)',
};

const bodyStyle: React.CSSProperties = {
  overflow: 'auto',
  minHeight: 0,
  paddingRight: 2,
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
};

