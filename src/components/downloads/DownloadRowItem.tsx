import { Link } from 'react-router-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useState } from 'react';
import { useT } from '../../lib/i18n';
import { translateBackendMessage } from '../../lib/backendMessage';
import { useDownloadSettings } from '../../contexts/DownloadSettings';
import { formatDownloadSpeed } from '../../lib/downloadSettings';
import { isArchivePath, cleanDownloadFileName } from '../../lib/archives';
import {
  canChangeDownloadProvider,
  hostNeedsApiKeyHint,
} from '../../lib/downloadLibrarySync';
import { HOST_COLORS, STREAMABLE_HOSTS } from '../../lib/downloadHosts';
import type { DownloadProgress, DownloadRow } from '../../types/download';
import {
  formatBytes,
  formatDuration,
  formatEta,
  stateKey,
} from '../../types/download';
import type { DownloadGameInfo } from './DownloadCard';
import { LibraryThumbnail } from '../library/LibraryThumbnail';

export interface DownloadCardProps {
  row: DownloadRow;
  progress?: DownloadProgress;
  game?: DownloadGameInfo;
  showAssign?: boolean;
  onAssign?: () => void;
  onCancel?: () => void;
  onRemove?: () => void;
  onReveal?: () => void;
  onRetry?: () => void;
  onExtract?: () => void;
  onOpenCaptcha?: () => void;
  onContinueCaptcha?: () => void;
  onChangeProvider?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

const LIVE_STATES = new Set([
  'downloading',
  'extracting',
  'resolving',
  'pending',
  'awaiting_choice',
]);

/** Unified card for active and history downloads. Progress only on live rows. */
export function DownloadCard({
  row,
  progress,
  game,
  showAssign,
  onAssign,
  onCancel,
  onRemove,
  onReveal,
  onRetry,
  onExtract,
  onOpenCaptcha,
  onContinueCaptcha,
  onChangeProvider,
  onContextMenu,
}: DownloadCardProps) {
  const { t } = useT();
  const { settings: dlSettings } = useDownloadSettings();
  const [extracting, setExtracting] = useState(false);
  const [continuing, setContinuing] = useState(false);

  const isLive = LIVE_STATES.has(row.state);
  const isExtracting = row.state === 'extracting';
  const extractPct = isExtracting ? (progress?.extractPercent ?? null) : null;
  const liveBytes = progress?.bytes ?? row.bytesDone;
  const liveTotal = progress?.total ?? row.bytesTotal;
  const pct = isLive
    ? isExtracting
      ? extractPct
      : liveTotal && liveTotal > 0
        ? Math.min(100, (liveBytes / liveTotal) * 100)
        : null
    : null;

  const displayTitle = game?.title ?? t('dl.thread', { id: row.threadId });
  const fileName = fileLabel(row, displayTitle);
  const size = formatBytes(row.bytesTotal ?? row.bytesDone);
  const captchaHost = supportsCaptchaWindow(row.host);
  const showApiKeyHint =
    row.state === 'needs_browser' && hostNeedsApiKeyHint(row.host);
  const showUnsupportedHint =
    row.state === 'needs_browser' &&
    !captchaHost &&
    !showApiKeyHint &&
    !STREAMABLE_HOSTS.has(row.host.trim().toLowerCase());
  const showChangeProvider =
    !!onChangeProvider && canChangeDownloadProvider(row);
  const isArchive = row.destPath ? isArchivePath(row.destPath) : false;
  const hostKey = row.host.trim().toLowerCase();
  const hostColor = HOST_COLORS[hostKey];

  const date = row.finishedAt
    ? new Date(row.finishedAt).toLocaleString(undefined, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  const statusLabel =
    row.state === 'needs_browser'
      ? captchaHost
        ? t('downloads.action.captchaShort')
        : t('downloads.action.openBrowserShort')
      : t(stateKey(row.state));

  return (
    <article
      className={`dl-card${isLive ? ' dl-card-live' : ''}`}
      onContextMenu={onContextMenu}
    >
      <Link to={`/store/game/${row.threadId}`} className="dl-card-thumb">
        {game?.thumbnailUrl ? (
          <LibraryThumbnail src={game.thumbnailUrl} alt="" />
        ) : (
          displayTitle.slice(0, 1).toUpperCase()
        )}
      </Link>

      <div className="dl-card-main">
        <div className="dl-card-title-row">
          <Link to={`/store/game/${row.threadId}`} className="dl-card-title">
            {displayTitle}
          </Link>
          {isLive && pct !== null && (
            <span className="dl-card-pct">{pct.toFixed(0)}%</span>
          )}
        </div>
        <span className="dl-card-file" title={row.destPath ?? row.sourceUrl}>
          {fileName}
        </span>
      </div>

      <div className="dl-card-meta">
        <span className={`dl-pill dl-pill-${row.state}`} title={statusLabel}>
          {statusLabel}
        </span>
        {showApiKeyHint && (
          <span className="dl-pill dl-pill-no-api-key" title={t('downloads.hint.noApiKey.title')}>
            {t('downloads.hint.noApiKey')}
          </span>
        )}
        {showUnsupportedHint && (
          <span className="dl-pill dl-pill-unsupported" title={t('downloads.hint.unsupported.title')}>
            {t('downloads.hint.unsupported')}
          </span>
        )}
        <span
          className="dl-card-host"
          style={hostColor ? { borderColor: hostColor, color: hostColor } : undefined}
        >
          {row.host}
        </span>
        {row.gameVersion && (
          <span className="dl-card-meta-item">v{row.gameVersion}</span>
        )}
        {!isLive && <span className="dl-card-meta-item">{size}</span>}
        {!isLive && date && <span className="dl-card-meta-item">{date}</span>}
      </div>

      {isLive && pct !== null && (
        <div className="dl-card-progress-wrap">
          <div
            className="dl-card-progress-fill"
            style={{ width: `${pct ?? (isExtracting ? 100 : 0)}%` }}
          />
        </div>
      )}

      {isLive && (
        <div className="dl-card-stats">
          {isExtracting ? (
            <>
              {t('downloads.action.extracting')}
              {extractPct != null && <> · {extractPct}%</>}
              {progress?.extractEtaSecs != null && progress.extractEtaSecs > 0 && (
                <>
                  {' '}
                  ·{' '}
                  {t('dllist.meta.eta', {
                    eta: formatDuration(progress.extractEtaSecs),
                  })}
                </>
              )}
            </>
          ) : (
            <>
              {formatBytes(liveBytes)}
              {liveTotal ? ` / ${formatBytes(liveTotal)}` : ''}
              {progress && progress.speedBps > 0 && (
                <> · {formatDownloadSpeed(progress.speedBps, dlSettings.speedInMbps)}</>
              )}
              {progress && progress.speedBps > 0 && liveTotal && (
                <>
                  {' '}
                  ·{' '}
                  {t('dllist.meta.eta', {
                    eta: formatEta(liveTotal - liveBytes, progress.speedBps),
                  })}
                </>
              )}
            </>
          )}
        </div>
      )}

      {row.errorMessage && row.state === 'failed' && (
        <p className="dl-card-error">{translateBackendMessage(row.errorMessage, t)}</p>
      )}

      <div className="dl-card-actions">
        {isLive && showAssign && onAssign && (
          <button type="button" className="dl-action-btn dl-action-btn-accent" onClick={onAssign}>
            {t('install.assign.cta')}
          </button>
        )}
        {isLive && onCancel && (
          <button
            type="button"
            className="dl-link-btn"
            onClick={onCancel}
          >
            {t('downloads.action.cancel')}
          </button>
        )}

        {!isLive && row.state === 'needs_browser' && captchaHost && row.resolvedUrl && (
          <>
            <button type="button" className="dl-action-btn" onClick={onOpenCaptcha}>
              {t('downloads.action.openCaptcha')}
            </button>
            <button
              type="button"
              className="dl-action-btn dl-action-btn-accent"
              disabled={continuing}
              onClick={async () => {
                if (!onContinueCaptcha) return;
                setContinuing(true);
                try {
                  await onContinueCaptcha();
                } finally {
                  setContinuing(false);
                }
              }}
            >
              {continuing
                ? t('downloads.action.continuingCaptcha')
                : t('downloads.action.continueCaptcha')}
            </button>
          </>
        )}
        {!isLive && row.state === 'needs_browser' && !captchaHost && row.resolvedUrl && (
          <button type="button" className="dl-action-btn" onClick={() => openUrl(row.resolvedUrl!)}>
            {t('downloads.action.openBrowserShort')}
          </button>
        )}
        {!isLive && showChangeProvider && (
          <button
            type="button"
            className="dl-action-btn dl-action-btn-accent"
            onClick={onChangeProvider}
            title={t('downloads.action.changeProvider.title')}
          >
            {t('downloads.action.changeProvider')}
          </button>
        )}
        {!isLive && showAssign && onAssign && (
          <button type="button" className="dl-action-btn dl-action-btn-accent" onClick={onAssign}>
            {t('install.assign.cta')}
          </button>
        )}
        {!isLive && row.state === 'completed' && row.destPath && (
          <>
            {isArchive && onExtract && (
              <button
                type="button"
                className="dl-action-btn dl-action-btn-accent"
                disabled={extracting}
                onClick={async () => {
                  setExtracting(true);
                  try {
                    await onExtract();
                  } finally {
                    setExtracting(false);
                  }
                }}
              >
                {extracting ? t('downloads.action.extracting') : t('downloads.action.extract')}
              </button>
            )}
            {onReveal && (
              <button type="button" className="dl-action-btn" onClick={onReveal}>
                {t('downloads.action.revealShort')}
              </button>
            )}
            <Link to={`/library/game/${row.threadId}`} className="dl-action-btn">
              {t('downloads.action.libraryShort')}
            </Link>
          </>
        )}
        {!isLive &&
          (row.state === 'failed' || row.state === 'cancelled' || row.state === 'needs_browser') &&
          onRetry && (
            <button type="button" className="dl-action-btn dl-action-btn-accent" onClick={onRetry}>
              {t('downloads.action.retry')}
            </button>
          )}
        {!isLive && onRemove && (
          <button type="button" className="dl-action-btn dl-action-btn-muted" onClick={onRemove}>
            {t('common.remove')}
          </button>
        )}
      </div>
    </article>
  );
}

/** @deprecated Use DownloadCard */
export const DownloadActiveCard = DownloadCard;

/** @deprecated Use DownloadCard */
export const DownloadHistoryRow = DownloadCard;

function supportsCaptchaWindow(host: string): boolean {
  return host.trim().toLowerCase() === 'mixdrop';
}

function looksLikeGarbageName(name: string): boolean {
  return (
    name.length >= 32 &&
    !name.includes('.') &&
    /^[a-zA-Z0-9_-]+$/.test(name)
  );
}

function fileLabel(row: DownloadRow, fallbackTitle?: string): string {
  if (row.destPath) {
    const base = row.destPath.split(/[/\\]/).pop() ?? row.destPath;
    const cleaned = cleanDownloadFileName(base);
    if (!looksLikeGarbageName(cleaned)) return cleaned;
  }
  const url = row.resolvedUrl ?? row.sourceUrl;
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const filename =
      parts.length >= 3 && parts[0] === 'download' && parts[2]?.includes('.')
        ? parts[2]
        : parts.pop();
    if (filename && !looksLikeGarbageName(filename)) return filename;
  } catch {
    /* fall through */
  }
  if (fallbackTitle) return fallbackTitle;
  return row.state === 'needs_browser' ? 'Google Drive' : url;
}
