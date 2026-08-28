import { openUrl } from '@tauri-apps/plugin-opener';
import type { ContextMenuItem } from '../../components/contextMenu/types';
import type { NavigateFunction } from 'react-router-dom';
import { isArchivePath } from '../archives';
import type { DownloadRow } from '../../types/download';
import type { TranslateFn } from '../libraryGameActions';
import { canPauseDownload } from '../downloadPause';
import { item, offlineTitle, sep } from './helpers';

function supportsCaptchaWindow(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'gdrive' || h === 'workupload' || h === 'mixdrop' || h === 'buzzheavier';
}

export interface DownloadMenuCallbacks {
  onCancel?: () => void | Promise<void>;
  onPause?: () => void | Promise<void>;
  onResume?: () => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
  onReveal?: () => void | Promise<void>;
  onExtract?: () => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
  onOpenCaptcha?: () => void | Promise<void>;
  onContinueCaptcha?: () => void | Promise<void>;
}

export interface DownloadMenuDeps {
  navigate: NavigateFunction;
  isOffline: boolean;
  t: TranslateFn;
  callbacks: DownloadMenuCallbacks;
}

export function buildDownloadMenu(
  row: DownloadRow,
  deps: DownloadMenuDeps,
): ContextMenuItem[] {
  const { navigate, isOffline, t, callbacks } = deps;
  const off = offlineTitle(isOffline, t);
  const captchaHost = supportsCaptchaWindow(row.host);
  const isArchive = row.destPath ? isArchivePath(row.destPath) : false;
  const pageUrl = row.resolvedUrl ?? row.sourceUrl;

  const items: ContextMenuItem[] = [
    item('detail', t('contextMenu.openStoreDetail'), () => {
      navigate(`/store/game/${row.threadId}`);
    }),
  ];

  if (canPauseDownload(row) && callbacks.onPause) {
    items.push(
      item('pause', t('contextMenu.pauseDownload'), callbacks.onPause, {
        disabled: isOffline,
        title: off,
      }),
    );
  }

  if (row.state === 'paused' && callbacks.onResume) {
    items.push(
      item('resume', t('contextMenu.resumeDownload'), callbacks.onResume, {
        disabled: isOffline,
        title: off,
      }),
    );
  }

  if (
    row.state === 'pending' ||
    row.state === 'resolving' ||
    row.state === 'downloading' ||
    row.state === 'extracting' ||
    row.state === 'paused'
  ) {
    if (callbacks.onCancel) {
      const extracting = row.state === 'extracting';
      items.push(
        item(
          'cancel',
          extracting ? t('downloads.action.cancel') : t('contextMenu.cancelDownload'),
          callbacks.onCancel,
          extracting
            ? undefined
            : {
                disabled: isOffline,
                title: off,
              },
        ),
      );
    }
  }

  if (row.state === 'failed' && callbacks.onRetry) {
    items.push(
      item('retry', t('contextMenu.retryDownload'), callbacks.onRetry, {
        disabled: isOffline,
        title: off,
        danger: false,
      }),
    );
  }

  if (row.state === 'needs_browser' && row.resolvedUrl) {
    if (captchaHost && callbacks.onOpenCaptcha) {
      items.push(
        item('captcha', t('downloads.action.openCaptcha'), callbacks.onOpenCaptcha, {
          disabled: isOffline,
          title: off,
        }),
      );
    }
    if (captchaHost && callbacks.onContinueCaptcha) {
      items.push(
        item('continueCaptcha', t('downloads.action.continueCaptcha'), callbacks.onContinueCaptcha, {
          disabled: isOffline,
          title: off,
        }),
      );
    }
    if (!captchaHost) {
      items.push(
        item('browser', t('downloads.action.openBrowserShort'), () => openUrl(pageUrl), {
          disabled: isOffline,
          title: off,
        }),
      );
    }
  }

  if (row.state === 'completed' && row.destPath) {
    if (isArchive && callbacks.onExtract) {
      items.push(
        item('extract', t('contextMenu.extractArchive'), callbacks.onExtract, {
          disabled: isOffline,
          title: off,
        }),
      );
    }
    if (callbacks.onReveal) {
      items.push(item('reveal', t('contextMenu.revealInExplorer'), callbacks.onReveal));
    }
  }

  if (row.state === 'completed' || row.state === 'failed' || row.state === 'cancelled') {
    if (callbacks.onRemove) {
      items.push(
        sep('sep'),
        item('remove', t('contextMenu.removeDownload'), callbacks.onRemove, { danger: true }),
      );
    }
  }

  return items;
}
