import { useState, type ReactNode } from 'react';
import { useDownloads as useDownloadsHook } from '../hooks/useDownloads';
import {
  HostFileChoiceModal,
  type HostFileChoiceOption,
} from '../components/HostFileChoiceModal';
import * as downloads from '../lib/downloads';
import * as ipc from '../lib/ipc';
import * as library from '../lib/library';
import { recoverStatusAfterDownloadFailure } from '../lib/downloadLibrarySync';
import {
  findJobByDownloadId,
  markJobAssign,
  recomputePlanStatus,
} from '../lib/installPlans';
import { dialog } from '../lib/dialog';
import { useT } from '../lib/i18n';
import { formatIpcError } from '../lib/ipcError';
import { DownloadsContext } from './downloadsContext';

/**
 * Single subscription to `download:*` events for the whole app. Mount once
 * at the app root so the status bar and Downloads page share live progress.
 */
interface FileChoiceRequest {
  downloadId: number;
  threadId: string;
  libraryPath?: string | null;
  host: string;
  platformGroup: string | null;
  recommendedFileId?: string | null;
  files: HostFileChoiceOption[];
}

export function DownloadsProvider({ children }: { children: ReactNode }) {
  const { t } = useT();
  const [fileChoice, setFileChoice] = useState<FileChoiceRequest | null>(null);
  const value = useDownloadsHook({ onNeedsFileChoice: setFileChoice });
  const [choiceBusy, setChoiceBusy] = useState(false);

  async function onConfirmFileChoice(choiceId: string) {
    if (!fileChoice || choiceBusy) return;
    setChoiceBusy(true);
    try {
      await ipc.downloadContinueChoice({
        id: fileChoice.downloadId,
        choiceId,
        threadId: fileChoice.threadId,
        libraryPath: fileChoice.libraryPath,
      });
      setFileChoice(null);
      await value.reload();
    } catch (err) {
      await dialog.alert(t('modal.hostFile.failed', { error: formatIpcError(err) }), {
        kind: 'error',
      });
    } finally {
      setChoiceBusy(false);
    }
  }

  return (
    <DownloadsContext.Provider value={value}>
      {children}
      <HostFileChoiceModal
        open={fileChoice != null}
        host={fileChoice?.host ?? ''}
        platformGroup={fileChoice?.platformGroup ?? null}
        recommendedFileId={fileChoice?.recommendedFileId}
        files={fileChoice?.files ?? []}
        onCancel={async () => {
          if (fileChoice) {
            await ipc.downloadCancel(fileChoice.downloadId);
            await downloads.markCancelled(fileChoice.downloadId);
            try {
              const linkedJob = await findJobByDownloadId(fileChoice.downloadId);
              if (linkedJob) {
                await markJobAssign(linkedJob.id, 'failed', {
                  errorMessage: 'cancelled',
                });
                await recomputePlanStatus(linkedJob.planId);
              }
            } catch {
              /* ignore */
            }
            try {
              const game = await library.get(fileChoice.threadId);
              if (game) {
                await library.setStatus(
                  fileChoice.threadId,
                  recoverStatusAfterDownloadFailure(game),
                );
              }
            } catch {
              /* not in library */
            }
            await value.reload();
          }
          setFileChoice(null);
        }}
        onConfirm={onConfirmFileChoice}
      />
    </DownloadsContext.Provider>
  );
}

export type { FileChoiceRequest };

export { useDownloads } from './downloadsContext';
