import { dialog } from './dialog';
import { tStandalone } from './i18n';

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function copyTextWithFeedback(text: string): Promise<void> {
  const ok = await copyTextToClipboard(text);
  if (ok) {
    await dialog.alert(tStandalone('contextMenu.copied'), { kind: 'info' });
  } else {
    await dialog.alert(tStandalone('contextMenu.copyFailed'), { kind: 'error' });
  }
}
