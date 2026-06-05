import type { ContextMenuItem } from '../../components/contextMenu/types';
import type { TranslateFn } from '../libraryGameActions';

export function offlineTitle(isOffline: boolean, t: TranslateFn): string | undefined {
  return isOffline ? t('contextMenu.offlineDisabled') : undefined;
}

export function sep(id: string): ContextMenuItem {
  return { id, label: '', onClick: () => {}, separator: true };
}

export function item(
  id: string,
  label: string,
  onClick: () => void | Promise<void>,
  opts?: Partial<ContextMenuItem>,
): ContextMenuItem {
  return { id, label, onClick, ...opts };
}
