import { useState } from 'react';
import type { GameDownload } from '../types/game';
import type { LibraryGame } from '../types/library';
import { LibraryInstallModal } from '../components/library/LibraryInstallModal';
import { InstallPlanWizard } from '../components/library/InstallPlanWizard';
import {
  ensureLinks,
  LibraryLinksError,
  type LinkIntent,
} from '../lib/libraryDownloadLinks';
import * as library from '../lib/library';
import { dialog } from '../lib/dialog';
import { useT } from '../lib/i18n';

type FlowMode = 'wizard' | 'browse';

export function useLibraryInstallFlow(opts?: { onStarted?: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<FlowMode>('wizard');
  const [game, setGame] = useState<LibraryGame | null>(null);
  const [links, setLinks] = useState<GameDownload[]>([]);
  const [busy, setBusy] = useState(false);

  async function beginInstallOrUpdate(g: LibraryGame) {
    if (busy) return;
    const intent: LinkIntent =
      g.installStatus === 'update_available' ? 'update' : 'install';
    setBusy(true);
    try {
      const fresh = (await library.get(g.threadId)) ?? g;
      const ensured = await ensureLinks(fresh, intent);
      setGame(fresh);
      setLinks(ensured);
      setMode('wizard');
      setOpen(true);
    } catch (err) {
      if (err instanceof LibraryLinksError && err.code === 'empty_links') {
        await dialog.alert(t('library.install.noLinks'), { kind: 'error' });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        await dialog.alert(t('library.install.linksFailed', { error: msg }), {
          kind: 'error',
        });
      }
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setMode('wizard');
  }

  const gameVersion =
    game?.availableVersion ??
    game?.downloadLinksVersion ??
    game?.currentVersion ??
    null;

  const intent: 'install' | 'update' =
    game?.installStatus === 'update_available' ? 'update' : 'install';

  const modal =
    game != null && open ? (
      mode === 'wizard' ? (
        <InstallPlanWizard
          open
          threadId={game.threadId}
          title={game.title}
          links={links}
          gameVersion={gameVersion}
          intent={intent}
          onClose={close}
          onStarted={opts?.onStarted}
          onBrowseAll={() => setMode('browse')}
        />
      ) : (
        <LibraryInstallModal
          open
          game={game}
          links={links}
          gameVersion={gameVersion}
          onClose={close}
          onStarted={opts?.onStarted}
          onBackToPlan={() => setMode('wizard')}
        />
      )
    ) : null;

  return { beginInstallOrUpdate, modal, busy };
}
