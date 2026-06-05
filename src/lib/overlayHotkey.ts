import {
  getExperimentalSettings,
  loadExperimentalSettings,
  saveExperimentalSettings,
  subscribeExperimentalSettings,
} from './experimentalSettings';
import * as ipc from './ipc';

let lastRegisteredHotkey: string | null = null;
let lastRegistrationOk = true;
let lastRegistrationMessage: string | null = null;

async function syncHotkeyFromRust(): Promise<void> {
  await loadExperimentalSettings();
  const exp = getExperimentalSettings();

  console.info('[overlay] sync hotkey: enabled=', exp.overlayEnabled, 'hotkey=', exp.overlayHotkey);

  if (!exp.overlayEnabled) {
    const result = await ipc.overlaySyncHotkey(false, exp.overlayHotkey);
    lastRegisteredHotkey = null;
    lastRegistrationOk = result.registered;
    lastRegistrationMessage = result.message;
    console.info('[overlay] hotkey desregistrado (overlay off)');
    return;
  }

  const hotkey = exp.overlayHotkey.trim();
  if (!hotkey) {
    console.warn('[overlay] hotkey vazio — registro ignorado');
    return;
  }

  const result = await ipc.overlaySyncHotkey(true, hotkey);
  lastRegistrationOk = result.registered;
  lastRegistrationMessage = result.message;

  if (result.registered) {
    lastRegisteredHotkey = result.hotkey;
    console.info('[overlay] hotkey registrado:', result.hotkey, result.message ?? '');
    if (result.hotkey !== hotkey) {
      await saveExperimentalSettings({ overlayHotkey: result.hotkey });
      console.info('[overlay] atalho ajustado:', result.message ?? result.hotkey);
    }
  } else {
    lastRegisteredHotkey = null;
    console.warn('[overlay] falha ao registrar hotkey:', result.message ?? '(sem detalhe)');
  }
}

export async function syncOverlayHotkey(): Promise<void> {
  await syncHotkeyFromRust();
}

export function startOverlayHotkeySync(): () => void {
  void syncOverlayHotkey();
  const unsubSettings = subscribeExperimentalSettings(() => {
    void syncOverlayHotkey();
  });

  return () => {
    unsubSettings();
    void ipc.overlaySyncHotkey(false, getExperimentalSettings().overlayHotkey).catch(() => {});
    lastRegisteredHotkey = null;
  };
}

export function getRegisteredOverlayHotkey(): string | null {
  return lastRegisteredHotkey;
}

export function isOverlayHotkeyRegistered(): boolean {
  return lastRegistrationOk;
}

export function getOverlayHotkeyRegistrationMessage(): string | null {
  return lastRegistrationMessage;
}
