import { openUrl } from '@tauri-apps/plugin-opener';
import type { ContextMenuItem } from '../../components/contextMenu/types';
import { copyTextWithFeedback } from '../clipboard';
import type { TranslateFn } from '../libraryGameActions';
import { item, offlineTitle } from './helpers';

export function buildRssItemMenu(
  threadUrl: string,
  storePath: string,
  opts: { isOffline: boolean; t: TranslateFn; navigate: (path: string) => void },
): ContextMenuItem[] {
  const off = offlineTitle(opts.isOffline, opts.t);
  return [
    item('store', opts.t('contextMenu.openDetail'), () => opts.navigate(storePath)),
    item('open', opts.t('gamedetail.action.openThread'), () => openUrl(threadUrl), {
      disabled: opts.isOffline,
      title: off,
    }),
    item('copy', opts.t('contextMenu.copyLink'), () => copyTextWithFeedback(threadUrl)),
  ];
}
