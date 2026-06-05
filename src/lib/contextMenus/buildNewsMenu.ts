import { openUrl } from '@tauri-apps/plugin-opener';
import type { ContextMenuItem } from '../../components/contextMenu/types';
import { copyTextWithFeedback } from '../clipboard';
import type { TranslateFn } from '../libraryGameActions';
import { item, offlineTitle } from './helpers';

export function buildNewsActivityMenu(
  url: string | null,
  opts: { isOffline: boolean; t: TranslateFn },
): ContextMenuItem[] {
  if (!url) return [];
  const off = offlineTitle(opts.isOffline, opts.t);
  return [
    item('open', opts.t('contextMenu.openLink'), () => openUrl(url), {
      disabled: opts.isOffline,
      title: off,
    }),
    item('copy', opts.t('contextMenu.copyLink'), () => copyTextWithFeedback(url)),
  ];
}
